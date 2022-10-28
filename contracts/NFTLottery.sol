// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/interfaces/KeeperCompatibleInterface.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/INFTCollection.sol";
import "./interfaces/IPool.sol";

contract NFTLottery is VRFConsumerBaseV2, KeeperCompatibleInterface, Ownable {
    //--------------------------------------------------------------------
    // VARIABLES

    // chainlink keepers parameters
    VRFCoordinatorV2Interface private immutable vrfCoordinator;
    uint64 private immutable subscriptionId;
    bytes32 private immutable gasLane;
    uint32 private immutable callbackGasLimit;
    uint16 private constant REQUEST_CONFIRMATIONS = 3;

    // USE uint256 instead of bool to save gas
    // paused = 1 & active = 2
    uint256 public paused = 1;

    uint256 private _totalDAIDeposited;
    uint256 private _lotteryStartTimestamp;
    LOTTERY_STATE private _lotteryState = LOTTERY_STATE.CLOSED;

    uint256 public lotteryPeriod = 1 days;
    uint256 public lotteryDelay = 1 hours;
    uint256 public lotteryNftRewardCount = 1;
    // the price of the ticket in DAI (100 DAI)
    uint256 public ticketBasePrice = 100 * 1e18;
    uint256 public winnersPerLottery = 1;
    
    IERC20 immutable dai;
    IERC20 immutable aDai;
    IPool immutable pool;
    INFTCollection immutable nft;

    address[] private participants;
    mapping(address => Participant) isParticipant;

    struct Participant {
        uint256 id;
        bool hasParticipated;
    }

    enum LOTTERY_STATE {
        OPEN,
        CLOSED,
        CALCULATING_WINNER
    }

    //--------------------------------------------------------------------
    // EVENTS

    event Lottery__Enter(address account, uint256 amount, uint256 depositedAt);
    event Lottery__Quit(address account, uint256 amount, uint256 withdrawAt);
    event Lottery__IsOpen(uint256 start, uint256 timestamp);
    event Lottery__IsClosed(uint256 timestamp);
    event Lottery__WinnersPicked(
        address[] winners,
        uint256 reward,
        uint256 timestamp
    );
    event Lottery__RequestWinners(uint256 requestId);
    event Lottery__TicketPriceChanged(uint256 ticketPrice, uint256 timestamp);
    event Lottery__WinnersPerLotteryChanged(
        uint256 winnersCount,
        uint256 timestamp
    );
    event Lottery__PeriodChanged(uint256 period, uint256 timestamp);
    event Lottery__DelayChanged(uint256 delay, uint256 timestamp);
    event Lottery__NftRewardCountChanged(uint256 nftCount, uint256 timestamp);
    event Lottery__Paused(uint256 timestamp);

    //--------------------------------------------------------------------
    // ERRORS

    error Lottery__IsNotOpen();
    error Lottery__IsNotClosed();
    error Lottery__ChangesNotAllowed();
    error Lottery__AlreadyInParticipants();
    error Lottery__TransferFailed();
    error Lottery__ApprovalFailed();
    error NFTLottery__UpkeepNotNeeded(
        LOTTERY_STATE state,
        uint256 participantsCount
    );

    //--------------------------------------------------------------------
    // MODIFIER

    // can only change lottery parameters when :
    // 1- Lottery is paused AND 2- Lottery is closed
    modifier canChange() {
        if (paused == 2 || _lotteryState != LOTTERY_STATE.CLOSED) {
            revert Lottery__ChangesNotAllowed();
        }
        _;
    }

    //--------------------------------------------------------------------
    // CONSTRUCTOR

    constructor(
        address _vrfCoordinatorV2,
        uint64 _subscriptionId,
        bytes32 _gasLane, // keyHash
        uint32 _callbackGasLimit,
        address _daiAddress,
        address _aDaiAddress,
        address _ledingPoolAddress,
        address _nftAddress,
        uint256 _ticketPrice
    ) VRFConsumerBaseV2(_vrfCoordinatorV2) {
        vrfCoordinator = VRFCoordinatorV2Interface(_vrfCoordinatorV2);
        gasLane = _gasLane;
        subscriptionId = _subscriptionId;
        callbackGasLimit = _callbackGasLimit;

        nft = INFTCollection(_nftAddress);
        dai = IERC20(_daiAddress);
        aDai = IERC20(_aDaiAddress);
        pool = IPool(_ledingPoolAddress);

        ticketBasePrice = _ticketPrice;
    }

    //--------------------------------------------------------------------
    // FUNCTIONS

    function enter() external {
        if (isParticipant[msg.sender].hasParticipated) {
            revert Lottery__AlreadyInParticipants();
        }
        uint256 userNftCount = nft.balanceOf(msg.sender);
        uint256 _entryPrice = ticketBasePrice * (1 + userNftCount);

        uint256 _newId = participants.length;

        bool success = dai.transferFrom(msg.sender, address(this), _entryPrice);
        if (!success) {
            revert Lottery__TransferFailed();
        }

        _totalDAIDeposited = _totalDAIDeposited + _entryPrice;

        _depositToAAVE(_entryPrice);

        participants.push(msg.sender);
        isParticipant[msg.sender] = Participant(_newId, true);

        emit Lottery__Enter(msg.sender, _entryPrice, block.timestamp);
    }

    function quit() external {
        uint256 amount = _quit(msg.sender);

        emit Lottery__Quit(msg.sender, amount, block.timestamp);
    }

    function checkUpkeep(bytes calldata checkData)
        public
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        // check if lottery need to be opened
        if (keccak256(checkData) == keccak256(hex"01")) {
            bool isClosed = _lotteryState == LOTTERY_STATE.CLOSED;
            bool isNotPaused = paused == 2;
            upkeepNeeded = (isClosed && isNotPaused);
            performData = checkData;
        }

        // check if lottery has reached closing period
        if (keccak256(checkData) == keccak256(hex"02")) {
            bool isOpen = _lotteryState == LOTTERY_STATE.OPEN;
            bool lotteryPeriodEnded = block.timestamp >
                (_lotteryStartTimestamp + lotteryPeriod);
            bool hasParticipants = participants.length > 0;

            upkeepNeeded = (isOpen && lotteryPeriodEnded && hasParticipants);
            performData = checkData;
        }
    }

    function performUpkeep(bytes calldata performData) external override {
        (bool upkeepNeeded, ) = checkUpkeep(performData);
        if (!upkeepNeeded) {
            revert NFTLottery__UpkeepNotNeeded(
                _lotteryState,
                participants.length
            );
        }
        // CASE 1 : open the lottery
        if (keccak256(performData) == keccak256(hex"01")) {
            open();
        }
        // CASE 2 : close the lottery and pick the winner
        if (keccak256(performData) == keccak256(hex"02")) {
            close();
        }
    }

    function fulfillRandomWords(
        uint256, /* requestId */
        uint256[] memory randomWords
    ) internal override {
        uint256 len = randomWords.length;
        address[] memory winnersAddresses = new address[](len);

        // get first winner list because quit function changes participants ids
        for (uint256 i; i < len; ) {
            uint256 _random = randomWords[i];
            uint256 winnerindex = _random % participants.length;
            address winner = participants[winnerindex];
            winnersAddresses[i] = winner;
            unchecked {
                ++i;
            }
        }

        // quit & mint nft for winners
        for (uint256 i; i < len; ) {
            address winner = winnersAddresses[i];
            // Remove the winner from the partcipant list and give him back his entry cost in DAI
            _quit(winner);
            // Mint the nfts for the winner
            nft.mint(winner, lotteryNftRewardCount);
            unchecked {
                ++i;
            }
        }
        emit Lottery__WinnersPicked(
            winnersAddresses,
            lotteryNftRewardCount,
            block.timestamp
        );

        _lotteryState = LOTTERY_STATE.CLOSED;
    }

    //--------------------------------------------------------------------
    // Internal Functions

    function open() internal {
        if (_lotteryState == LOTTERY_STATE.OPEN) revert Lottery__IsNotClosed();
        _lotteryState = LOTTERY_STATE.OPEN;
        _lotteryStartTimestamp = block.timestamp + lotteryDelay;

        emit Lottery__IsOpen(_lotteryStartTimestamp, block.timestamp);
    }

    function close() internal {
        if (_lotteryState != LOTTERY_STATE.OPEN) revert Lottery__IsNotOpen();
        _lotteryState = LOTTERY_STATE.CALCULATING_WINNER;

        emit Lottery__IsClosed(block.timestamp);

        uint256 requestId = vrfCoordinator.requestRandomWords(
            gasLane,
            subscriptionId,
            REQUEST_CONFIRMATIONS,
            callbackGasLimit,
            uint32(winnersPerLottery)
        );

        emit Lottery__RequestWinners(requestId);
    }

    function _quit(address account) internal returns (uint256) {
        uint256 userNftCount = nft.balanceOf(account);
        uint256 _amount = ticketBasePrice * (1 + userNftCount);

        uint256 _participantId = isParticipant[account].id;

        _remove(_participantId);
        delete isParticipant[account];

        _withdrawFromAAVE(account, _amount);

        _totalDAIDeposited = _totalDAIDeposited - _amount;

        return _amount;
    }

    function _depositToAAVE(uint256 amount) internal {
        bool success = dai.approve(address(pool), amount);
        if (!success) {
            revert Lottery__ApprovalFailed();
        }
        pool.deposit(address(dai), amount, address(this), 0);
    }

    function _withdrawFromAAVE(address to, uint256 amount) internal {
        bool success = aDai.approve(address(pool), amount);
        if (!success) {
            revert Lottery__ApprovalFailed();
        }
        pool.withdraw(address(dai), amount, to);
    }

    function _remove(uint256 index) internal {
        uint256 lastIndex = participants.length - 1;
        if (lastIndex == 0) {
            // reset participants array if only one address exists
            delete participants;
        } else {
            // swap last index with the removed index
            address lastParticipant = participants[lastIndex];
            participants[index] = lastParticipant;
            isParticipant[lastParticipant].id = index;

            participants.pop();
        }
    }

    //--------------------------------------------------------------------
    // View Functions

    function getParticipantsList() external view returns (address[] memory) {
        return participants;
    }

    function getLotteryState() external view returns (LOTTERY_STATE) {
        return _lotteryState;
    }

    function lotteryStartingTimestamp() external view returns (uint256) {
        return _lotteryStartTimestamp;
    }

    function lotteryDAIBalance() external view returns (uint256) {
        return _totalDAIDeposited;
    }

    //--------------------------------------------------------------------
    // Admin Functions

    function _setLotteryTicketBasePrice(uint256 _newTicketPrice)
        external
        onlyOwner
        canChange
    {
        ticketBasePrice = _newTicketPrice;

        emit Lottery__TicketPriceChanged(_newTicketPrice, block.timestamp);
    }

    function _setWinnersPerLottery(uint256 _winners)
        external
        onlyOwner
        canChange
    {
        winnersPerLottery = _winners;

        emit Lottery__WinnersPerLotteryChanged(_winners, block.timestamp);
    }

    function _setLotteryPeriod(uint256 _newPeriod)
        external
        onlyOwner
        canChange
    {
        lotteryPeriod = _newPeriod;

        emit Lottery__PeriodChanged(_newPeriod, block.timestamp);
    }

    function _setLotteryDelay(uint256 _newDelay) external onlyOwner canChange {
        lotteryDelay = _newDelay;

        emit Lottery__DelayChanged(_newDelay, block.timestamp);
    }

    function _setlotteryNftRewardCount(uint256 _newLotteryNftRewardCount)
        external
        onlyOwner
        canChange
    {
        lotteryNftRewardCount = _newLotteryNftRewardCount;

        emit Lottery__NftRewardCountChanged(
            _newLotteryNftRewardCount,
            block.timestamp
        );
    }

    function pause(uint256 _state) external payable onlyOwner {
        if (_state == 1 || _state == 2) {
            paused = _state;
            emit Lottery__Paused(block.timestamp);
        }
    }

    function withdrawAccumulatedInterest() external payable onlyOwner {
        uint256 lotteryDaiBalance = _totalDAIDeposited;
        uint256 _aDaiBalance = aDai.balanceOf(address(this));

        if (_aDaiBalance > lotteryDaiBalance) {
            uint256 _totalInterest;
            unchecked {
                _totalInterest = _aDaiBalance - lotteryDaiBalance;
            }
            _withdrawFromAAVE(owner(), _totalInterest);
        }
    }
}
