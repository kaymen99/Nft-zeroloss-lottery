// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

import "@chainlink/contracts/src/v0.8/interfaces/KeeperCompatibleInterface.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBase.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/INFTCollection.sol";
import "./interfaces/IPool.sol";

contract NFTLottery is VRFConsumerBase, KeeperCompatibleInterface, Ownable {
    //--------------------------------------------------------------------
    // VARIABLES

    bytes32 public keyhash;
    uint256 public fee;

    uint256 private _totalDAIDeposited;

    // USE uint256 instead of bool to save gas
    // paused = 1 & active = 2
    uint256 public paused = 1;

    LOTTERY_STATE private _lotteryState = LOTTERY_STATE.CLOSED;
    uint256 private _lotteryStartTimestamp;
    uint256 public lotteryPeriod;
    uint256 public lotteryDelay;
    uint256 public lotteryNftRewardCount;
    // the price of the ticket in DAI (100 DAI)
    uint256 public ticketBasePrice = 100 * 1e18;

    IERC20 dai;
    IERC20 aDai;
    IPool pool;
    INFTCollection nft;

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
    event Lottery__IsOpen(uint256 timestamp);
    event Lottery__IsClosed(uint256 timestamp);
    event Lottery__WinnerPicked(
        address winner,
        uint256 reward,
        uint256 timestamp
    );
    event RequestRandomness(bytes32 requestId);
    event Lottery__TicketPriceChanged(uint256 ticketPrice, uint256 timestamp);
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
        address _vrfcoordinator,
        address _link,
        uint256 _fee,
        bytes32 _keyhash,
        address _daiAddress,
        address _aDaiAddress,
        address _ledingPoolAddress,
        address _nftAddress,
        uint256 _ticketPrice
    ) VRFConsumerBase(_vrfcoordinator, _link) {
        fee = _fee;
        keyhash = _keyhash;

        nft = INFTCollection(_nftAddress);
        dai = IERC20(_daiAddress);
        aDai = IERC20(_aDaiAddress);
        pool = IPool(_ledingPoolAddress);

        _lotteryState = LOTTERY_STATE.CLOSED;
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

        isParticipant[msg.sender] = Participant(_newId, true);
        participants.push(msg.sender);

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

    function fulfillRandomness(bytes32, uint256 _randomness) internal override {
        require(_randomness > 0, "rondom not found");
        uint256 winnerindex = _randomness % participants.length;
        address winner = participants[winnerindex];

        // Remove the winner from the partcipant list and give him back his entry cost in DAI
        _quit(winner);

        // Mint the nfts for the winner
        nft.mint(winner, lotteryNftRewardCount);

        emit Lottery__WinnerPicked(
            winner,
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

        emit Lottery__IsOpen(block.timestamp);
    }

    function close() internal {
        if (_lotteryState != LOTTERY_STATE.OPEN) revert Lottery__IsNotOpen();
        _lotteryState = LOTTERY_STATE.CALCULATING_WINNER;

        emit Lottery__IsClosed(block.timestamp);

        bytes32 requestid = requestRandomness(keyhash, fee);
        emit RequestRandomness(requestid);
    }

    function _quit(address account) internal returns (uint256) {
        uint256 userNftCount = nft.balanceOf(account);
        uint256 _amount = ticketBasePrice * (1 + userNftCount);

        uint256 _participantId = isParticipant[account].id;

        delete isParticipant[account];
        _remove(_participantId);

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
            delete participants[lastIndex];
            participants[index] = lastParticipant;
            isParticipant[lastParticipant].id = index;
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
