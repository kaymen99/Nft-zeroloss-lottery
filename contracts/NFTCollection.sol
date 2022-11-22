// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract NFTCollection is ERC721Enumerable, Ownable {
    using Strings for uint256;

    //--------------------------------------------------------------------
    // VARIABLES

    string public baseURI;
    address public controller;
    uint256 public immutable maxSupply;

    // USE uint256 instead of bool to save gas
    // paused = 1 & active = 2
    uint256 public paused = 1;

    //--------------------------------------------------------------------
    // ERRORS

    error NFTCollection__ContractIsPaused();
    error NFTCollection__OnlyController();
    error NFTCollection__NftSupplyLimitExceeded();
    error NFTCollection__InvalidMintAmount();
    error NFTCollection__QueryForNonExistentToken();

    //--------------------------------------------------------------------
    // CONSTRUCTOR

    constructor(uint256 _maxSupply) ERC721("Lottery Collectible", "LC") {
        maxSupply = _maxSupply;
    }

    //--------------------------------------------------------------------
    // MINT FUNCTIONS

    function mint(address account, uint256 amount) external payable {
        if (msg.sender != controller) revert NFTCollection__OnlyController();
        if (paused == 1) revert NFTCollection__ContractIsPaused();
        if (amount == 0) revert NFTCollection__InvalidMintAmount();
        uint256 supply = totalSupply();
        if (supply + amount > maxSupply)
            revert NFTCollection__NftSupplyLimitExceeded();

        for (uint256 i = 1; i <= amount; ) {
            _safeMint(account, supply + i);
            unchecked {
                ++i;
            }
        }
    }

    //--------------------------------------------------------------------
    // OWNER FUNCTIONS

    function setBaseURI(string memory _newBaseURI) external payable onlyOwner {
        baseURI = _newBaseURI;
    }

    function pause(uint256 _state) external payable onlyOwner {
        if (_state == 1 || _state == 2) paused = _state;
    }

    function setController(address _controller) external payable onlyOwner {
        controller = _controller;
    }

    //--------------------------------------------------------------------
    // VIEW FUNCTIONS

    function walletOfOwner(address _owner)
        external
        view
        returns (uint256[] memory)
    {
        uint256 ownerTokenCount = balanceOf(_owner);
        uint256[] memory tokenIds = new uint256[](ownerTokenCount);
        for (uint256 i; i < ownerTokenCount; ) {
            tokenIds[i] = tokenOfOwnerByIndex(_owner, i);
            unchecked {
                ++i;
            }
        }
        return tokenIds;
    }

    function tokenURI(uint256 tokenId)
        public
        view
        virtual
        override
        returns (string memory)
    {
        if (!_exists(tokenId)) revert NFTCollection__QueryForNonExistentToken();

        string memory currentBaseURI = _baseURI();
        return
            bytes(currentBaseURI).length > 0
                ? string(
                    abi.encodePacked(
                        currentBaseURI,
                        tokenId.toString(),
                        ".json"
                    )
                )
                : "";
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return baseURI;
    }
}
