// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IUniswapV2Router02.sol";

contract ERC20Faucet {
    /// STATE VARIABLES
    address public uniswapV2RouterAddress;
    address public erc20Address;
    IUniswapV2Router02 public uniswapRouter;

    /// CONSTRUCTOR
    constructor(address _uniswapV2RouterAddress, address _erc20Address) {
        uniswapV2RouterAddress = _uniswapV2RouterAddress;
        erc20Address = _erc20Address;
        uniswapRouter = IUniswapV2Router02(_uniswapV2RouterAddress);
    }

    /// TRANSACTIONS
    function swapETHtoERC20() public payable {
        // getting path between ETH and DAI
        address[] memory path = new address[](2);
        path[0] = uniswapRouter.WETH();
        path[1] = erc20Address;

        uniswapRouter.swapExactETHForTokens{value: msg.value}(
            0,
            path,
            msg.sender,
            block.timestamp
        );
    }
}
