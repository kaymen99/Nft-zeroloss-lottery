const hre = require("hardhat");
const fs = require('fs');
const fse = require("fs-extra");
const { verify } = require('../utils/verify')
const { getAmountInWei, developmentChains, networkConfig } = require('../utils/helpers');


async function main() {
  const deployNetwork = hre.network.name

  const netConfig = networkConfig[hre.network.config.chainId]
  const maxSupply = 10000
  const ticketPrice = 100 // lottery ticket price = 100 DAI

  // Deploy NFTCollection contract 
  const NFTContract = await ethers.getContractFactory("NFTCollection");
  const nftContract = await NFTContract.deploy(maxSupply);

  // Deploy NFTLottery contract 
  const Lottery = await ethers.getContractFactory("NFTLottery");
  const lotteryContract = await Lottery.deploy(
    netConfig["vrfCoordinatorV2"],
    netConfig["subscriptionId"],
    netConfig["gasLane"],
    netConfig["callbackGasLimit"],
    netConfig["daiAddress"],
    netConfig["aDaiAddress"],
    netConfig["AAVELendingPool"],
    nftContract.address,
    getAmountInWei(ticketPrice)
  );

  // Set the lottery contract as the NFT mint controller
  await nftContract.setController(lotteryContract.address)

  console.log("NFT Collection contract deployed at:\n", nftContract.address);
  console.log("NFT Lottery deployed at:\n", lotteryContract.address);
  console.log("Network deployed :\n", deployNetwork);

  /* transfer contracts addresses & ABIs to the front-end */
  if (fs.existsSync("../front-end/src")) {
    fse.copySync("./artifacts/contracts", "../front-end/src/artifacts")
    fs.writeFileSync("../front-end/src/utils/contracts-config.js", `
      export const lotteryContractAddress = "${lotteryContract.address}"
      export const nftContractAddress = "${nftContract.address}"
      export const ownerAddress = "${lotteryContract.signer.address}"
      export const networkDeployedTo = "${hre.network.config.chainId}"
    `)
  }

  if (!developmentChains.includes(deployNetwork) && hre.config.etherscan.apiKey[deployNetwork]) {
    console.log("waiting for 6 blocks verification ...")
    await stakingVault.deployTransaction.wait(6)

    // args represent contract constructor arguments
    const args = [
      netConfig["vrfCoordinatorV2"],
      netConfig["subscriptionId"],
      netConfig["gasLane"],
      netConfig["callbackGasLimit"],
      netConfig["daiAddress"],
      netConfig["aDaiAddress"],
      netConfig["AAVELendingPool"],
      nftContract.address,
      getAmountInWei(ticketPrice)
    ]
    await verify(lotteryContract.address, args)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });


