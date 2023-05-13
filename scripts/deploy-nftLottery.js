const hre = require("hardhat");
const fs = require("fs");
const fse = require("fs-extra");
const { verify } = require("../utils/verify");
const {
  getAmountInWei,
  deployVRFCoordinatorMock,
  deployERC20Mock,
  deployLendingPoolMock,
  developmentChains,
  networkConfig,
} = require("../utils/helpers");

async function main() {
  const deployNetwork = hre.network.name;

  const netConfig = networkConfig[hre.network.config.chainId];
  const maxSupply = 10000;
  const lotteryParams = {
    nftRewardCount: 1,
    winnersPerRound: 1,
    delay: 3600, // 1 hour
    startTimestamp: 0,
    duration: 24 * 3600, // 1 day
    ticketPrice: getAmountInWei(100), // lottery ticket price = 100 DAI
  };

  let subscriptionId,
    daiTokenAddress,
    aDaiTokenAddress,
    poolAddress,
    vrfCoordinatorAddress;

  if (developmentChains.includes(deployNetwork)) {
    let vrfCoordinatorMock;
    [vrfCoordinatorMock, subscriptionId] = await deployVRFCoordinatorMock();
    const daiTokenMock = await deployERC20Mock();
    const aDaiTokenMock = await deployERC20Mock();
    const poolMock = await deployLendingPoolMock(aDaiTokenAddress);
    vrfCoordinatorAddress = vrfCoordinatorMock.address;
    daiTokenAddress = daiTokenMock.address;
    aDaiTokenAddress = aDaiTokenMock.address;
    poolAddress = poolMock.address;
  } else {
    vrfCoordinatorAddress = netConfig["vrfCoordinatorV2"];
    subscriptionId = netConfig["subscriptionId"];
    daiTokenAddress = netConfig["daiAddress"];
    aDaiTokenAddress = netConfig["aDaiAddress"];
    poolAddress = netConfig["AAVELendingPool"];
  }

  // Deploy NFTCollection contract
  const NFTContract = await ethers.getContractFactory("NFTCollection");
  const nftContract = await NFTContract.deploy(maxSupply);

  // Deploy NFTLottery contract
  const Lottery = await ethers.getContractFactory("NFTLottery");
  const lotteryContract = await Lottery.deploy(
    vrfCoordinatorAddress,
    subscriptionId,
    netConfig["gasLane"],
    netConfig["callbackGasLimit"],
    daiTokenAddress,
    aDaiTokenAddress,
    poolAddress,
    nftContract.address,
    lotteryParams
  );

  // Set the lottery contract as the NFT mint controller
  await nftContract.setController(lotteryContract.address);

  console.log("NFT Collection contract deployed at:\n", nftContract.address);
  console.log("NFT Lottery deployed at:\n", lotteryContract.address);
  console.log("Network deployed :\n", deployNetwork);

  /* 
  transfer contracts addresses & ABIs to the front-end 
  
  if (fs.existsSync("../front-end/src")) {
    fse.copySync("./artifacts/contracts", "../front-end/src/artifacts")
    fs.writeFileSync("../front-end/src/utils/contracts-config.js", `
      export const lotteryContractAddress = "${lotteryContract.address}"
      export const nftContractAddress = "${nftContract.address}"
      export const ownerAddress = "${lotteryContract.signer.address}"
      export const networkDeployedTo = "${hre.network.config.chainId}"
    `)
  }
  */

  if (
    !developmentChains.includes(deployNetwork) &&
    hre.config.etherscan.apiKey[deployNetwork]
  ) {
    console.log("waiting for 6 blocks verification ...");
    await lotteryContract.deployTransaction.wait(6);

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
      lotteryParams,
    ];
    await verify(lotteryContract.address, args);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
