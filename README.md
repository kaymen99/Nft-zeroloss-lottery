<div id="top"></div>

<!-- ABOUT THE PROJECT -->

# NFT Lossless lottery

This project contains smart contracts for a lossless NFT lottery that levrage the AAVE protocol to guarentee a zero entrance fee and is completely automated with the help of chainlink keepers.

### Built With

* [Solidity](https://docs.soliditylang.org/)
* [Hardhat](https://hardhat.org/getting-started/)
* [openzeppelin](https://docs.openzeppelin.com)
* [chainlink](https://docs.chain.link/docs/conceptual-overview/)

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#how-it-works">How it works</a></li>
    <li><a href="#project-structure">Project structure</a></li>
    <li>
      <a href="#how-to-run">How to Run</a>
      <ul>
       <li><a href="#prerequisites">Prerequisites</a></li>
       <li><a href="#contracts">Contracts</a></li>
      </ul>
    </li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#license">License</a></li>
  </ol>
</details>

<!-- Working -->

## How it works



<p align="right">(<a href="#top">back to top</a>)</p>

<!-- PROJECT STRUCTURE -->

## Project Structure

The contracts development and testing is done using the Hardhat framework, for this project there are 2 main contracts :
      <ul>
       <li><b>NFTCollection.sol :</b></li>
This is the NFT collection contract, i used the ERC721Enumerable standard with a fixed maximum supply, the NFT Lottery contract is set as  controller of the collection and is the only address able to mint new items to the lottery winners. 
       <li><b>NFTLottery.sol :</b></li>
The lottery contract allow user to enter and quit the lottery and it uses chainlink VRF coordinator to get random numbers and pick the winners, the contract is automated using chainlink keepers to make lottery start/end process run without any external interaction.    
      </ul>
<p align="right">(<a href="#top">back to top</a>)</p>

<!-- USAGE GUIDE -->
## How to Run

### Prerequisites

Please install or have installed the following:
* [nodejs](https://nodejs.org/en/download/) and [yarn](https://classic.yarnpkg.com/en/)

Clone this repository with the command :

   ```sh
   git clone https://github.com/kaymen99/NFT-Lossless-lottery.git
   ```

### Contracts

As mentioned before the contracts are developed with the Hardhat framework, before deploying them you must first install the required dependancies by running :
   ```sh
   cd NFT-Lossless-lottery
   yarn
   ```
   
Next you need to setup the environement variables in the .env file, this are used when deploying the contracts :

   ```sh
    MAINNET_FORK_ALCHEMY_URL=https://eth-mainnet.alchemyapi.io/v2/<api-key>
    RINKEBY_ETHERSCAN_API_KEY=<api-key>
    RINKEBY_RPC_URL=https://eth-rinkeby.alchemyapi.io/v2/<api-key>
    POLYGON_RPC_URL="Your polygon RPC url from alchemy or infura"
    MUMBAI_RPC_URL="Your mumbai RPC url from alchemy or infura"
    PRIVATE_KEY=<private-key>
   ```
* <b>NOTE :</b> Only the private key is needed when deploying to the ganache network, the others variables are for deploying to the testnets or real networks and etherscan api key is for verifying your contracts on rinkeby etherscan.

* <b>NOTE :</b> To deploy on real/test networks you must get a chainlink subscription [here](https://vrf.chain.link).

After going through all the configuration step, you'll need to deploy the 2 contracts to the ganache network by running: 
   ```sh
   yarn deploy --network ganache
   ```
   
* <b>IMPORTANT :</b> I used the ganache network for development purposes only, you can choose another testnet or real network if you want, for that you need to add it to the hardhat.config file for example for the rinkeby testnet  

   ```sh
   rinkeby: {
      url: RINKEBY_RPC_URL,
      accounts: [process.env.PRIVATE_KEY],
      chainId: 4,
    }
   ```

If you want go through the contracts unit test, you can do it by running:
   ```sh
   yarn test ./test/lottery-unit-test.js
   ```
And to test the end to end working cycle of the lottery run the command :
   ```sh
   yarn test ./test/lottery-e2e-test.js
   ```

<p align="right">(<a href="#top">back to top</a>)</p>

<!-- Contact -->
## Contact

If you have any question or problem running this project just contact me: aymenMir1001@gmail.com

<p align="right">(<a href="#top">back to top</a>)</p>


<!-- LICENSE -->
## License

Distributed under the MIT License. See `LICENSE.txt` for more information.

<p align="right">(<a href="#top">back to top</a>)</p>

