const { ethers } = require("hardhat");

let daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f"

const developmentChains = ["hardhat", "localhost", "ganache"]

const networkConfig = {
    default: {
        name: "hardhat",
        daiAddress: "0x6b175474e89094c44da98b954eedeac495271d0f",
        aDaiAddress: "0x028171bCA77440897B824Ca71D1c56caC55b68A3",
        AAVELendingPool: "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9",
        vrfcoordinator: "0xf0d54349aDdcf704F77AE15b96510dEA15cb7952",
        linkAddress: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
        keyHash: "0xAA77729D3466CA35AE8D28B3BBAC7CC36A5031EFDC430821C02BC31A238AF445",
        fee: 2,
    },
    31337: {
        name: "localhost",
        daiAddress: "0x6b175474e89094c44da98b954eedeac495271d0f",
        aDaiAddress: "0x028171bCA77440897B824Ca71D1c56caC55b68A3",
        AAVELendingPool: "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9",
        vrfcoordinator: "0xf0d54349aDdcf704F77AE15b96510dEA15cb7952",
        linkAddress: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
        keyHash: "0xAA77729D3466CA35AE8D28B3BBAC7CC36A5031EFDC430821C02BC31A238AF445",
        fee: 2,
    },
    1: {
        name: "mainnet",
        daiAddress: "0x6b175474e89094c44da98b954eedeac495271d0f",
        aDaiAddress: "0x028171bCA77440897B824Ca71D1c56caC55b68A3",
        AAVELendingPool: "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9",
        vrfcoordinator: "0xf0d54349aDdcf704F77AE15b96510dEA15cb7952",
        linkAddress: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
        keyHash: "0xAA77729D3466CA35AE8D28B3BBAC7CC36A5031EFDC430821C02BC31A238AF445",
        fee: 2,
    },
    4: {
        name: "rinkeby",
        daiAddress: "",
        aDaiAddress: "",
        AAVELendingPool: "",
        vrfcoordinator: "",
        linkAddress: "30",
        fee: "100000000000000000",
        keyHash: "500000",
    },
    137: {
        name: "polygon",
        daiAddress: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
        aDaiAddress: "0x27F8D03b3a2196956ED754baDc28D73be8830A6e",
        AAVELendingPool: "0x8dff5e27ea6b7ac08ebfdf9eb090f32ee9a30fcf",
        vrfcoordinator: "0x3d2341ADb2D31f1c5530cDC622016af293177AE0",
        linkAddress: "0xb0897686c545045aFc77CF20eC7A532E3120E0F1",
        keyHash: "0xf86195cf7690c55907b2b611ebb7343a6f649bff128701cc542f0569e2c549da",
        fee: 0.0001,
    },
}

function getAmountInWei(amount) {
    return ethers.utils.parseEther(amount.toString(), "ether")
}
function getAmountFromWei(amount) {
    return Number(ethers.utils.formatUnits(amount.toString(), "ether"))
}

async function getWeth(account, amount) {
    const wethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
    const iWeth = await ethers.getContractAt(
        "IWeth",
        wethAddress,
    )
    const txResponse = await iWeth.connect(account).deposit({
        value: getAmountInWei(amount)
    })
    await txResponse.wait(1)
}

async function mintAndApproveDai(account, ethAmount, spender, approvedAmount) {
    await getWeth(account, ethAmount)

    const uniswapRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"

    const Faucet = await ethers.getContractFactory("ERC20Faucet");
    const daiFaucet = await Faucet.deploy(uniswapRouterAddress, daiAddress);

    await daiFaucet.connect(account).swapETHtoERC20(
        { value: getAmountInWei(ethAmount) }
    )
    const dai = await ethers.getContractAt("IERC20", daiAddress)
    const tx = await dai.connect(account).approve(spender, approvedAmount)
    await tx.wait(1)
}

async function moveTime(waitingPeriod) {
    await ethers.provider.send('evm_increaseTime', [waitingPeriod]);
    await ethers.provider.send('evm_mine');
}


module.exports = {
    developmentChains,
    networkConfig,
    getAmountFromWei,
    getAmountInWei,
    mintAndApproveDai,
    moveTime
}