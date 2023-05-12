// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./utils/ChainlinkUtils.sol";
import "./interfaces/INFTCollection.sol";
import "./interfaces/IPool.sol";

contract NFTLottery is ChainlinkUtils, Ownable {
    //--------------------------------------------------------------------
    // VARIABLES

    address[] private participants;
    mapping(address => Participant) isParticipant;

    uint256 private _totalDAIDeposited;

    struct LotteryParams {
        uint32 nftRewardCount;
        uint32 winnersPerRound;
        uint32 delay;
        uint64 startTimestamp;
        uint64 duration;
        uint256 ticketPrice;
    }

    struct State {
        uint32 nftRewardCount;
        uint32 winnersPerRound;
        uint32 delay;
        uint64 startTimestamp;
        uint64 duration;
        bool paused;
        LOTTERY_STATUS status;
        uint256 ticketPrice;
    }
    State public lotteryState;

    IERC20 immutable dai;
    IERC20 immutable aDai;
    IPool immutable pool;
    INFTCollection immutable nft;

    struct Participant {
        uint224 id;
        bool hasParticipated;
    }

    enum LOTTERY_STATUS {
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
        uint32 winnersCount,
        uint256 timestamp
    );
    event Lottery__DurationChanged(uint64 duration, uint256 timestamp);
    event Lottery__DelayChanged(uint32 delay, uint256 timestamp);
    event Lottery__NftRewardCountChanged(uint32 nftCount, uint256 timestamp);
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
        LOTTERY_STATUS state,
        uint256 participantsCount
    );

    //--------------------------------------------------------------------
    // MODIFIER

    // can only change lottery parameters when :
    // 1- Lottery is paused AND 2- Lottery is closed
    modifier canChange() {
        if (
            !lotteryState.paused || lotteryState.status != LOTTERY_STATUS.CLOSED
        ) {
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
        LotteryParams memory _params
    )
        ChainlinkUtils(
            _vrfCoordinatorV2,
            _subscriptionId,
            _gasLane,
            _callbackGasLimit
        )
    {
        nft = INFTCollection(_nftAddress);
        dai = IERC20(_daiAddress);
        aDai = IERC20(_aDaiAddress);
        pool = IPool(_ledingPoolAddress);

        lotteryState.nftRewardCount = _params.nftRewardCount;
        lotteryState.winnersPerRound = _params.winnersPerRound;
        lotteryState.startTimestamp = _params.startTimestamp;
        lotteryState.duration = _params.duration;
        lotteryState.delay = _params.delay;
        lotteryState.ticketPrice = _params.ticketPrice;
        lotteryState.status = LOTTERY_STATUS.CLOSED;
        lotteryState.paused = true;
    }

    //--------------------------------------------------------------------
    // FUNCTIONS

    function enter() external {
        if (isParticipant[msg.sender].hasParticipated) {
            revert Lottery__AlreadyInParticipants();
        }
        uint256 userNftCount = nft.balanceOf(msg.sender);
        uint256 _entryPrice = lotteryState.ticketPrice * (1 + userNftCount);
        uint256 _newId = participants.length;

        bool success = dai.transferFrom(msg.sender, address(this), _entryPrice);
        if (!success) {
            revert Lottery__TransferFailed();
        }

        _totalDAIDeposited = _totalDAIDeposited + _entryPrice;
        _depositToAAVE(_entryPrice);

        participants.push(msg.sender);
        isParticipant[msg.sender] = Participant(uint224(_newId), true);

        emit Lottery__Enter(msg.sender, _entryPrice, block.timestamp);
    }

    function quit() external {
        uint256 amount = _quit(msg.sender);

        emit Lottery__Quit(msg.sender, amount, block.timestamp);
    }

    function checkUpkeep(
        bytes calldata checkData
    )
        public
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        // check if lottery need to be opened
        if (keccak256(checkData) == keccak256(hex"01")) {
            bool isClosed = lotteryState.status == LOTTERY_STATUS.CLOSED;
            upkeepNeeded = (isClosed && !lotteryState.paused);
            performData = checkData;
        }

        // check if lottery has reached closing period
        if (keccak256(checkData) == keccak256(hex"02")) {
            bool isOpen = lotteryState.status == LOTTERY_STATUS.OPEN;
            bool lotteryDurationEnded = block.timestamp >
                (lotteryState.startTimestamp + lotteryState.duration);
            bool hasParticipants = participants.length > 0;

            upkeepNeeded = (isOpen && lotteryDurationEnded && hasParticipants);
            performData = checkData;
        }
    }

    function performUpkeep(bytes calldata performData) external override {
        (bool upkeepNeeded, ) = checkUpkeep(performData);
        if (!upkeepNeeded) {
            revert NFTLottery__UpkeepNotNeeded(
                lotteryState.status,
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
        uint256 /* requestId */,
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

        uint256 reward = uint256(lotteryState.nftRewardCount);

        // quit & mint nft for winners
        for (uint256 i; i < len; ) {
            address winner = winnersAddresses[i];
            // Remove the winner from the partcipant list and give him back his entry cost in DAI
            _quit(winner);
            // Mint the nfts for the winner
            nft.mint(winner, reward);
            unchecked {
                ++i;
            }
        }

        lotteryState.status = LOTTERY_STATUS.CLOSED;
        emit Lottery__WinnersPicked(winnersAddresses, reward, block.timestamp);
    }

    //--------------------------------------------------------------------
    // Internal Functions

    function open() internal {
        if (lotteryState.status == LOTTERY_STATUS.OPEN)
            revert Lottery__IsNotClosed();
        lotteryState.status = LOTTERY_STATUS.OPEN;
        lotteryState.startTimestamp = uint64(
            block.timestamp + lotteryState.delay
        );

        emit Lottery__IsOpen(lotteryState.startTimestamp, block.timestamp);
    }

    function close() internal {
        if (lotteryState.status != LOTTERY_STATUS.OPEN)
            revert Lottery__IsNotOpen();
        lotteryState.status = LOTTERY_STATUS.CALCULATING_WINNER;

        emit Lottery__IsClosed(block.timestamp);

        uint256 requestId = vrfCoordinator.requestRandomWords(
            gasLane,
            subscriptionId,
            REQUEST_CONFIRMATIONS,
            callbackGasLimit,
            lotteryState.winnersPerRound
        );
        emit Lottery__RequestWinners(requestId);
    }

    function _quit(address account) internal returns (uint256) {
        uint256 userNftCount = nft.balanceOf(account);
        uint256 _amount = lotteryState.ticketPrice * (1 + userNftCount);
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
            isParticipant[lastParticipant].id = uint224(index);
            participants.pop();
        }
    }

    //--------------------------------------------------------------------
    // View Functions

    function getParticipantsList() external view returns (address[] memory) {
        return participants;
    }

    function getLotteryState() external view returns (State memory) {
        return lotteryState;
    }

    function lotteryStartingTimestamp() external view returns (uint256) {
        return lotteryState.startTimestamp;
    }

    function lotteryDAIBalance() external view returns (uint256) {
        return _totalDAIDeposited;
    }

    //--------------------------------------------------------------------
    // Admin Functions

    function _setLotteryTicketBasePrice(
        uint256 _newTicketPrice
    ) external onlyOwner canChange {
        lotteryState.ticketPrice = _newTicketPrice;
        emit Lottery__TicketPriceChanged(_newTicketPrice, block.timestamp);
    }

    function _setWinnersPerLottery(
        uint32 _winners
    ) external onlyOwner canChange {
        lotteryState.winnersPerRound = _winners;
        emit Lottery__WinnersPerLotteryChanged(_winners, block.timestamp);
    }

    function _setLotteryDuration(
        uint64 _newDuration
    ) external onlyOwner canChange {
        lotteryState.duration = _newDuration;
        emit Lottery__DurationChanged(_newDuration, block.timestamp);
    }

    function _setLotteryDelay(uint32 _newDelay) external onlyOwner canChange {
        lotteryState.delay = _newDelay;
        emit Lottery__DelayChanged(_newDelay, block.timestamp);
    }

    function _setlotteryNftRewardCount(
        uint32 _newLotteryNftRewardCount
    ) external onlyOwner canChange {
        lotteryState.nftRewardCount = _newLotteryNftRewardCount;
        emit Lottery__NftRewardCountChanged(
            _newLotteryNftRewardCount,
            block.timestamp
        );
    }

    function pause(bool _state) external payable onlyOwner {
        if (_state != lotteryState.paused) {
            lotteryState.paused = _state;
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
            _withdrawFromAAVE(msg.sender, _totalInterest);
        }
    }
}
