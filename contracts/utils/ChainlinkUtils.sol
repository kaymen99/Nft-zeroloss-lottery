// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/interfaces/KeeperCompatibleInterface.sol";

abstract contract ChainlinkUtils is
    VRFConsumerBaseV2,
    KeeperCompatibleInterface
{
    // chainlink keepers parameters
    VRFCoordinatorV2Interface immutable vrfCoordinator;
    uint64 immutable subscriptionId;
    bytes32 immutable gasLane;
    uint32 immutable callbackGasLimit;
    uint16 constant REQUEST_CONFIRMATIONS = 3;

    constructor(
        address _vrfCoordinatorV2,
        uint64 _subscriptionId,
        bytes32 _gasLane, // keyHash
        uint32 _callbackGasLimit
    ) VRFConsumerBaseV2(_vrfCoordinatorV2) {
        vrfCoordinator = VRFCoordinatorV2Interface(_vrfCoordinatorV2);
        gasLane = _gasLane;
        subscriptionId = _subscriptionId;
        callbackGasLimit = _callbackGasLimit;
    }
}
