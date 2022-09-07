const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const {
    getAmountInWei,
    getAmountFromWei,
    mintAndApproveDai,
    fundPoolWithADAI,
    moveTime,
    deployVRFCoordinatorMock,
    deployERC20Mock,
    deployLendingPoolMock,
    developmentChains,
    networkConfig
} = require('../utils/helpers');


const lotteryStates = { "Open": 0, "Closed": 1, "Calculating_winner": 2 }

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("NFT Lottery Unit Tests", () => {
        let owner;
        let lotteryContract;
        let nftContract;
        let subscriptionId;
        let daiTokenMock, daiTokenAddress;
        let aDaiTokenMock, aDaiTokenAddress;
        let poolMock, poolAddress;
        let vrfCoordinatorMock, vrfCoordinatorAddress;

        const netConfig = networkConfig[network.config.chainId]
        const maxSupply = 10000
        const ticketPrice = 100 // lottery ticket price = 100 DAI

        before(async () => {
            [owner, user1, user2, user3, randomUser] = await ethers.getSigners();

            if (network.config.chainId == 31337) {
                [vrfCoordinatorMock, subscriptionId] = await deployVRFCoordinatorMock()
                vrfCoordinatorAddress = vrfCoordinatorMock.address
                daiTokenMock = await deployERC20Mock()
                daiTokenAddress = daiTokenMock.address
                aDaiTokenMock = await deployERC20Mock()
                aDaiTokenAddress = aDaiTokenMock.address
                poolMock = await deployLendingPoolMock(aDaiTokenAddress)
                poolAddress = poolMock.address

            } else {
                vrfCoordinatorAddress = netConfig["vrfCoordinatorV2"]
                subscriptionId = netConfig["subscriptionId"]
                daiTokenAddress = netConfig["daiAddress"]
                aDaiTokenAddress = netConfig["aDaiAddress"]
                poolAddress = netConfig["AAVELendingPool"]
            }
        });

        describe("Correct Deployement", () => {
            before(async () => {
                // Deploy NFTCollection contract 
                const NFTContract = await ethers.getContractFactory("NFTCollection");
                nftContract = await NFTContract.deploy(maxSupply);

                // Deploy NFTLottery contract 
                const Lottery = await ethers.getContractFactory("NFTLottery");
                lotteryContract = await Lottery.deploy(
                    vrfCoordinatorAddress,
                    subscriptionId,
                    netConfig["gasLane"],
                    netConfig["callbackGasLimit"],
                    daiTokenAddress,
                    aDaiTokenAddress,
                    poolAddress,
                    nftContract.address,
                    getAmountInWei(ticketPrice)
                );

                // Set the lottery contract as the NFT mint controller
                await nftContract.connect(owner).setController(lotteryContract.address)

                // Fund pool mock with aDai tokens
                await fundPoolWithADAI(owner, poolAddress, aDaiTokenAddress)
            });
            it("NFT contract should have correct owner address", async () => {
                const ownerAddress = await owner.getAddress();
                expect(await nftContract.owner()).to.equal(ownerAddress);
            });
            it("NFT contract should have correct initial parameters", async () => {
                expect(await nftContract.baseURI()).to.equal("");
                expect(await nftContract.maxSupply()).to.equal(maxSupply);
                expect(await nftContract.paused()).to.equal(1);

                await expect(nftContract.tokenURI(1)).to.be.revertedWithCustomError(nftContract, 'NFTCollection__QueryForNonExistentToken');
            });
            it("NFT Lottery contract should have correct owner address", async () => {
                const ownerAddress = await owner.getAddress();
                expect(await lotteryContract.owner()).to.equal(ownerAddress);
            });
            it("NFT Lottery contract should have correct initial parameters", async () => {
                expect(await lotteryContract.paused()).to.equal(1);
                expect(await lotteryContract.getLotteryState()).to.be.equal(lotteryStates["Closed"]);
                expect(await lotteryContract.lotteryPeriod()).to.equal(24 * 3600);
                expect(await lotteryContract.lotteryDelay()).to.equal(3600);
                expect(await lotteryContract.lotteryNftRewardCount()).to.equal(1);
                expect(await lotteryContract.winnersPerLottery()).to.equal(1);
                expect(await lotteryContract.ticketBasePrice()).to.be.equal(getAmountInWei(ticketPrice));
            });
            it("NFT Lottery contract should be set as NFTCollection controller", async () => {
                expect(await nftContract.controller()).to.equal(lotteryContract.address);
            });
        });

        describe("Core Functions", () => {
            describe('Enter lottery function : enter()', () => {
                let entryAmount;
                before(async () => {
                    // Deploy NFTCollection contract 
                    const NFTContract = await ethers.getContractFactory("NFTCollection");
                    nftContract = await NFTContract.deploy(maxSupply);

                    // Deploy NFTLottery contract 
                    const Lottery = await ethers.getContractFactory("NFTLottery");
                    lotteryContract = await Lottery.deploy(
                        vrfCoordinatorAddress,
                        subscriptionId,
                        netConfig["gasLane"],
                        netConfig["callbackGasLimit"],
                        daiTokenAddress,
                        aDaiTokenAddress,
                        poolAddress,
                        nftContract.address,
                        getAmountInWei(ticketPrice)
                    );

                    // Set the lottery contract as the NFT mint controller
                    await nftContract.connect(owner).setController(lotteryContract.address)

                    // Fund pool mock with aDai tokens
                    await fundPoolWithADAI(owner, poolAddress, aDaiTokenAddress)
                });
                it("should allow user to enter lottery", async () => {
                    // get user1 nft balance (must be zero as no nft was minted)
                    const balance = await nftContract.balanceOf(user1.address)
                    // Calculate user1 lottery entry price
                    const entryPrice = ticketPrice * (1 + Number(balance))
                    entryAmount = getAmountInWei(entryPrice)

                    await mintAndApproveDai(
                        user1,
                        daiTokenAddress,
                        2000, // 2000 DAI
                        lotteryContract.address,
                        entryAmount
                    )

                    const tx = await lotteryContract.connect(user1).enter()
                    let txReceipt = await tx.wait(1)

                    const enterEvent = txReceipt.events[txReceipt.events.length - 1].args
                    expect(enterEvent.account).to.equal(user1.address);
                    expect(enterEvent.amount).to.equal(entryAmount);
                });
                it("should add new participant to the lottery", async () => {
                    const participants = await lotteryContract.getParticipantsList()
                    expect(participants.length).to.equal(1);
                    expect(participants[0]).to.equal(user1.address);
                });
                it("lottery should have correct DAI deposited balance", async () => {
                    expect(await lotteryContract.lotteryDAIBalance()).to.equal(entryAmount);
                });
                it("lottery should have correct aDAI balance", async () => {
                    const aDai = await ethers.getContractAt("IERC20Mock", aDaiTokenAddress)
                    const aDaiBalance = await aDai.balanceOf(lotteryContract.address)

                    expect(aDaiBalance).to.be.greaterThanOrEqual(entryAmount);
                });
                it("should revert if user is already a participant", async () => {
                    await expect(lotteryContract.connect(user1).enter()).to.be.revertedWithCustomError(lotteryContract, 'Lottery__AlreadyInParticipants');
                });
                it("should revert if user has insuffisant DAI amount", async () => {
                    // user2 has 0 DAI
                    await expect(lotteryContract.connect(user2).enter()).to.be.revertedWith('ERC20: insufficient allowance');
                });
            })

            describe('Quit lottery function : quit()', () => {
                let user1_daiBalance;
                let entryAmount;
                before(async () => {
                    // Deploy NFTCollection contract 
                    const NFTContract = await ethers.getContractFactory("NFTCollection");
                    nftContract = await NFTContract.deploy(maxSupply);

                    // Deploy NFTLottery contract 
                    const Lottery = await ethers.getContractFactory("NFTLottery");
                    lotteryContract = await Lottery.deploy(
                        vrfCoordinatorAddress,
                        subscriptionId,
                        netConfig["gasLane"],
                        netConfig["callbackGasLimit"],
                        daiTokenAddress,
                        aDaiTokenAddress,
                        poolAddress,
                        nftContract.address,
                        getAmountInWei(ticketPrice)
                    );

                    // Set the lottery contract as the NFT mint controller
                    await nftContract.connect(owner).setController(lotteryContract.address)

                    // Fund pool mock with aDai tokens
                    await fundPoolWithADAI(owner, poolAddress, aDaiTokenAddress)
                });
                it("should allow user to quit lottery", async () => {
                    // calculate DAI amount returned to user1 which is equal to his entryPrice
                    const balance = await nftContract.balanceOf(user1.address)
                    const entryPrice = ticketPrice * (1 + Number(balance))
                    entryAmount = getAmountInWei(entryPrice)

                    await mintAndApproveDai(
                        user1,
                        daiTokenAddress,
                        2000, // 2000 DAI
                        lotteryContract.address,
                        entryAmount
                    )
                    await lotteryContract.connect(user1).enter()

                    // Get user1 DAI balance before quiting
                    const dai = await ethers.getContractAt("IERC20Mock", daiTokenAddress)
                    user1_daiBalance = await dai.balanceOf(user1.address)

                    const tx = await lotteryContract.connect(user1).quit()
                    let txReceipt = await tx.wait(1)

                    const quitEvent = txReceipt.events[txReceipt.events.length - 1].args
                    expect(quitEvent.account).to.equal(user1.address);
                    expect(quitEvent.amount).to.equal(entryAmount);
                });
                it("should return total entry price to user", async () => {
                    // Get user1 DAI balance after quiting
                    const dai = await ethers.getContractAt("IERC20Mock", daiTokenAddress)
                    const user1_daiBalance_after = await dai.balanceOf(user1.address)

                    expect(getAmountFromWei(user1_daiBalance_after)).to.equal(
                        getAmountFromWei(user1_daiBalance) + getAmountFromWei(entryAmount)
                    );
                });
                it("should reset participants list if last participant has quited", async () => {
                    const participants = await lotteryContract.getParticipantsList()
                    expect(participants.length).to.equal(0);
                });
                it("should update DAI deposited balance", async () => {
                    expect(await lotteryContract.lotteryDAIBalance()).to.equal(0);
                });
                it("should remove user from participants list", async () => {
                    // Get entry cost for new users
                    const entryCost = await lotteryContract.ticketBasePrice()
                    await mintAndApproveDai(
                        user1,
                        daiTokenAddress,
                        1000, // 1000 DAI
                        lotteryContract.address,
                        entryCost
                    )
                    await lotteryContract.connect(user1).enter()

                    await mintAndApproveDai(
                        user2,
                        daiTokenAddress,
                        1000, // 1000 DAI
                        lotteryContract.address,
                        entryCost
                    )
                    await lotteryContract.connect(user2).enter()

                    await mintAndApproveDai(
                        user3,
                        daiTokenAddress,
                        1000, // 1000 DAI
                        lotteryContract.address,
                        entryCost
                    )
                    await lotteryContract.connect(user3).enter()

                    let participants = await lotteryContract.getParticipantsList()
                    expect(participants.length).to.equal(3);
                    expect(participants).to.have.members([
                        user1.address, user2.address, user3.address
                    ])

                    await lotteryContract.connect(user2).quit()

                    // Check that remove function work correctely
                    participants = await lotteryContract.getParticipantsList()
                    expect(participants.length).to.equal(2);
                    expect(participants).to.have.members([user1.address, user3.address])
                });
            })

            describe("checkUpkeep()", function () {
                before(async () => {
                    // Deploy NFTCollection contract 
                    const NFTContract = await ethers.getContractFactory("NFTCollection");
                    nftContract = await NFTContract.deploy(maxSupply);

                    // Deploy NFTLottery contract 
                    const Lottery = await ethers.getContractFactory("NFTLottery");
                    lotteryContract = await Lottery.deploy(
                        vrfCoordinatorAddress,
                        subscriptionId,
                        netConfig["gasLane"],
                        netConfig["callbackGasLimit"],
                        daiTokenAddress,
                        aDaiTokenAddress,
                        poolAddress,
                        nftContract.address,
                        getAmountInWei(ticketPrice)
                    );

                    // Set the lottery contract as the NFT mint controller
                    await nftContract.connect(owner).setController(lotteryContract.address)

                    // Fund pool mock with aDai tokens
                    await fundPoolWithADAI(owner, poolAddress, aDaiTokenAddress)
                });

                describe("open lottery checkUpkeep", function () {
                    // upkeepNeeded = (isClosed && isNotPaused)
                    it("returns false if lottery is paused", async () => {
                        const { upkeepNeeded } = await lotteryContract.callStatic.checkUpkeep("0x01")
                        expect(upkeepNeeded).to.equal(false);
                    })
                    it("returns true if lottery is closed and not paused", async () => {
                        // unpause lottery 
                        await lotteryContract.connect(owner).pause(2)

                        const { upkeepNeeded } = await lotteryContract.callStatic.checkUpkeep("0x01")
                        expect(upkeepNeeded).to.equal(true);
                    })
                })

                describe("close lottery checkUpkeep", function () {
                    // upkeepNeeded = (isOpen && lotteryPeriodEnded && hasParticipants);
                    it("returns false if lottery isn't open", async () => {
                        const { upkeepNeeded } = await lotteryContract.callStatic.checkUpkeep("0x02")
                        expect(upkeepNeeded).to.equal(false);
                    })
                    it("returns false if lottery period hasn't ended", async () => {
                        // performupkeep to open lottery 
                        await lotteryContract.performUpkeep("0x01")

                        // skip  5 hours
                        await moveTime(5 * 3600)

                        // check close lottery upkeep
                        const { upkeepNeeded } = await lotteryContract.callStatic.checkUpkeep("0x02")
                        expect(upkeepNeeded).to.equal(false);
                    })
                    it("returns false if lottery has not participant", async () => {
                        // skip 24 hours to end lottery period
                        await moveTime(24 * 3600)

                        // check close lottery upkeep
                        const { upkeepNeeded } = await lotteryContract.callStatic.checkUpkeep("0x02")
                        expect(upkeepNeeded).to.equal(false);
                    })
                    it("returns true if lottery close conditions are met", async () => {
                        const balance = await nftContract.balanceOf(user1.address)
                        const entryPrice = ticketPrice * (1 + Number(balance))

                        // add at least one participant
                        await mintAndApproveDai(
                            user1,
                            daiTokenAddress,
                            2000, // 2000 DAI
                            lotteryContract.address,
                            getAmountInWei(entryPrice)
                        )
                        await lotteryContract.connect(user1).enter()

                        // check close lottery upkeep
                        const { upkeepNeeded } = await lotteryContract.callStatic.checkUpkeep("0x02")
                        expect(upkeepNeeded).to.equal(true);
                    })
                })
            })

            describe("performUpkeep()", function () {
                before(async () => {
                    // Deploy NFTCollection contract 
                    const NFTContract = await ethers.getContractFactory("NFTCollection");
                    nftContract = await NFTContract.deploy(maxSupply);

                    // Deploy NFTLottery contract 
                    const Lottery = await ethers.getContractFactory("NFTLottery");
                    lotteryContract = await Lottery.deploy(
                        vrfCoordinatorAddress,
                        subscriptionId,
                        netConfig["gasLane"],
                        netConfig["callbackGasLimit"],
                        daiTokenAddress,
                        aDaiTokenAddress,
                        poolAddress,
                        nftContract.address,
                        getAmountInWei(ticketPrice)
                    );

                    // Set the lottery contract as the NFT mint controller
                    await nftContract.connect(owner).setController(lotteryContract.address)

                    // Fund pool mock with aDai tokens
                    await fundPoolWithADAI(owner, poolAddress, aDaiTokenAddress)
                });
                it("should only run if checkupkeep returns true", async () => {
                    // upkeepNeeded = (isClosed && isNotPaused)
                    const upkeep1 = await lotteryContract.callStatic.checkUpkeep("0x01")
                    expect(upkeep1.upkeepNeeded).to.equal(false);

                    // Try to performupkeep to open lottery 
                    await expect(lotteryContract.performUpkeep("0x01")).to.be.revertedWithCustomError(lotteryContract, 'NFTLottery__UpkeepNotNeeded');

                    // upkeepNeeded = (isOpen && lotteryPeriodEnded && hasParticipants)
                    const upkeep2 = await lotteryContract.callStatic.checkUpkeep("0x02")
                    expect(upkeep2.upkeepNeeded).to.equal(false);

                    // Try to performupkeep to close lottery 
                    await expect(lotteryContract.performUpkeep("0x02")).to.be.revertedWithCustomError(lotteryContract, 'NFTLottery__UpkeepNotNeeded');
                })
                let openTime;
                let startTime;
                let txReceipt;
                describe("open lottery upkeep", function () {
                    it("should open change the lottery state to Open", async () => {
                        // unpause lottery 
                        await lotteryContract.connect(owner).pause(2)

                        expect(await lotteryContract.paused()).to.equal(2);

                        // upkeepNeeded = (isClosed && isNotPaused)
                        const { upkeepNeeded } = await lotteryContract.callStatic.checkUpkeep("0x01")
                        expect(upkeepNeeded).to.equal(true);

                        // Try to performupkeep to open lottery 
                        const tx = await lotteryContract.performUpkeep("0x01")
                        let txReceipt = await tx.wait(1)

                        openTime = Number(txReceipt.events[0].args.timestamp);
                        startTime = Number(txReceipt.events[0].args.start);

                        expect(await lotteryContract.getLotteryState()).to.be.equal(lotteryStates["Open"]);
                    })
                    it("should update the lottery start timestamp", async () => {
                        const delay = await lotteryContract.lotteryDelay()
                        const expectedOpenTimstamp = openTime + Number(delay)

                        expect(await lotteryContract.lotteryStartingTimestamp()).to.be.equal(expectedOpenTimstamp);
                        expect(await lotteryContract.lotteryStartingTimestamp()).to.be.equal(startTime);

                    })
                })
                describe("close lottery upkeep", function () {

                    before(async () => {
                        // add three particpant
                        const entryCost = await lotteryContract.ticketBasePrice()
                        await mintAndApproveDai(
                            user1,
                            daiTokenAddress,
                            1000, // 1000 DAI
                            lotteryContract.address,
                            entryCost
                        )
                        await lotteryContract.connect(user1).enter()

                        await mintAndApproveDai(
                            user2,
                            daiTokenAddress,
                            1000, // 1000 DAI
                            lotteryContract.address,
                            entryCost
                        )
                        await lotteryContract.connect(user2).enter()

                        await mintAndApproveDai(
                            user3,
                            daiTokenAddress,
                            1000, // 1000 DAI
                            lotteryContract.address,
                            entryCost
                        )
                        await lotteryContract.connect(user3).enter()

                        // pass time to end lottery period
                        // 25 hours = 24h lottery period + 1h lottery start delay
                        await moveTime(25 * 3600)
                    });

                    it("should emit closed lottery event", async () => {
                        // close lottery 
                        const tx = await lotteryContract.performUpkeep("0x02")
                        txReceipt = await tx.wait(1)

                        const CloseEvent = txReceipt.events[0]

                        expect(CloseEvent.event).to.be.equal('Lottery__IsClosed')
                        expect(Number(CloseEvent.args.timestamp)).to.be.greaterThanOrEqual(
                            openTime + 25 * 3600
                        )
                    })
                    it("should change lottery state to calculating winner", async () => {
                        expect(await lotteryContract.getLotteryState()).to.be.equal(lotteryStates["Calculating_winner"]);
                    })
                    it("should emit request winners event", async () => {
                        const RequestWinnersEvent = txReceipt.events[2]

                        expect(RequestWinnersEvent.event).to.be.equal('Lottery__RequestWinners')
                        expect(Number(RequestWinnersEvent.args.requestId)).to.be.greaterThanOrEqual(1)
                    })
                })
            })

            describe("fulfillRandomWords()", function () {
                before(async () => {
                    // Deploy NFTCollection contract 
                    const NFTContract = await ethers.getContractFactory("NFTCollection");
                    nftContract = await NFTContract.deploy(maxSupply);

                    if (network.config.chainId == 31337) {
                        [vrfCoordinatorMock, subscriptionId] = await deployVRFCoordinatorMock()
                        vrfCoordinatorAddress = vrfCoordinatorMock.address
                    }

                    // Deploy NFTLottery contract 
                    const Lottery = await ethers.getContractFactory("NFTLottery");
                    lotteryContract = await Lottery.deploy(
                        vrfCoordinatorAddress,
                        subscriptionId,
                        netConfig["gasLane"],
                        netConfig["callbackGasLimit"],
                        daiTokenAddress,
                        aDaiTokenAddress,
                        poolAddress,
                        nftContract.address,
                        getAmountInWei(ticketPrice)
                    );

                    // Set the lottery contract as the NFT mint controller
                    await nftContract.connect(owner).setController(lotteryContract.address)

                    // unpause NFT contract
                    await nftContract.connect(owner).pause(2)

                    // Fund pool mock with aDai tokens
                    await fundPoolWithADAI(owner, poolAddress, aDaiTokenAddress)

                    // set number of winners per lottery to 2 for testing
                    await lotteryContract.connect(owner)._setWinnersPerLottery(2)

                    // unpause lottery 
                    await lotteryContract.connect(owner).pause(2)

                    // open lottery
                    await lotteryContract.performUpkeep("0x01")

                    // add three particpant
                    const entryCost = await lotteryContract.ticketBasePrice()
                    await mintAndApproveDai(
                        user1,
                        daiTokenAddress,
                        1000, // 1000 DAI
                        lotteryContract.address,
                        entryCost
                    )
                    await lotteryContract.connect(user1).enter()

                    await mintAndApproveDai(
                        user2,
                        daiTokenAddress,
                        1000, // 1000 DAI
                        lotteryContract.address,
                        entryCost
                    )
                    await lotteryContract.connect(user2).enter()

                    await mintAndApproveDai(
                        user3,
                        daiTokenAddress,
                        1000, // 1000 DAI
                        lotteryContract.address,
                        entryCost
                    )
                    await lotteryContract.connect(user3).enter()

                    // pass time to end lottery period
                    // 25 hours = 24h lottery period + 1h lottery start delay
                    await moveTime(25 * 3600)
                });
                it("should only be called after performupkeep", async () => {
                    await expect(
                        vrfCoordinatorMock.fulfillRandomWords(0, lotteryContract.address)
                    ).to.be.revertedWith("nonexistent request")
                    await expect(
                        vrfCoordinatorMock.fulfillRandomWords(1, lotteryContract.address)
                    ).to.be.revertedWith("nonexistent request")
                })
                let participantsList, winnersList;
                let aDai, lotteryDAIBalance, lotteryaDAIBalance;
                it("should calculate lottery winners when receiving random numbers from Chainlink VRF", async () => {
                    await new Promise(async (resolve, reject) => {
                        lotteryContract.once('Lottery__WinnersPicked', async (winners, reward, timestamp, winnerPickedEvent) => {
                            try {
                                // Check that correct event is emitted
                                expect(winnerPickedEvent.event).to.be.equal('Lottery__WinnersPicked')
                                winnersList = winners;
                                expect(winners.length).to.be.equal(Number(await lotteryContract.winnersPerLottery()))
                                expect(reward).to.be.equal(await lotteryContract.lotteryNftRewardCount())
                            } catch (e) {
                                reject(e)
                            }
                            resolve()
                        })
                        // Get lottery deposited DAI balnace
                        lotteryDAIBalance = await lotteryContract.lotteryDAIBalance()

                        // Get lottery initial aDAI balnace
                        aDai = await ethers.getContractAt("IERC20Mock", aDaiTokenAddress)
                        lotteryaDAIBalance = await aDai.balanceOf(lotteryContract.address)

                        // Get participant list 
                        participantsList = await lotteryContract.getParticipantsList()

                        // close lottery 
                        const tx = await lotteryContract.performUpkeep("0x02")
                        const txReceipt = await tx.wait(1)

                        const _requestId = Number(txReceipt.events[2].args.requestId)
                        await vrfCoordinatorMock.fulfillRandomWords(
                            _requestId,
                            lotteryContract.address
                        )
                    })
                })
                it("winners should be picked from the participant list", async () => {
                    expect(participantsList).to.include(winnersList[0])
                    expect(participantsList).to.include(winnersList[1])
                })
                it("should send NFTs reward to the winners", async () => {
                    const lotteryReward = await lotteryContract.lotteryNftRewardCount()
                    expect(await nftContract.balanceOf(winnersList[0])).to.be.equal(lotteryReward)
                    expect(await nftContract.balanceOf(winnersList[1])).to.be.equal(lotteryReward)
                })
                it("should return DAI entry amount to winners", async () => {
                    expect(await lotteryContract.lotteryDAIBalance()).to.be.lessThan(lotteryDAIBalance);
                    expect(await aDai.balanceOf(lotteryContract.address)).to.be.lessThan(lotteryaDAIBalance);
                })
                it("should change lottery state to Closed & update participant list", async () => {
                    const _participantsList = await lotteryContract.getParticipantsList()
                    expect(_participantsList.length).to.be.equal(participantsList.length - winnersList.length);
                    expect(await lotteryContract.getLotteryState()).to.be.equal(lotteryStates["Closed"]);
                })
            });
        });

        describe('Admin Functions', () => {
            before(async () => {
                // Deploy NFTCollection contract 
                const NFTContract = await ethers.getContractFactory("NFTCollection");
                nftContract = await NFTContract.deploy(maxSupply);

                // Deploy NFTLottery contract 
                const Lottery = await ethers.getContractFactory("NFTLottery");
                lotteryContract = await Lottery.deploy(
                    vrfCoordinatorAddress,
                    subscriptionId,
                    netConfig["gasLane"],
                    netConfig["callbackGasLimit"],
                    daiTokenAddress,
                    aDaiTokenAddress,
                    poolAddress,
                    nftContract.address,
                    getAmountInWei(ticketPrice)
                );

                // Set the lottery contract as the NFT mint controller
                await nftContract.connect(owner).setController(lotteryContract.address)

                // Fund pool mock with aDai tokens
                await fundPoolWithADAI(owner, poolAddress, aDaiTokenAddress)
            });
            it("only admin should be allowed to change NFT Lottery contract parametres & withdraw gains", async () => {
                await expect(
                    lotteryContract.connect(randomUser).pause(2)
                ).to.be.revertedWith('Ownable: caller is not the owner');
                await expect(
                    lotteryContract.connect(randomUser)._setLotteryTicketBasePrice(getAmountInWei(200))
                ).to.be.revertedWith('Ownable: caller is not the owner');
                await expect(
                    lotteryContract.connect(randomUser)._setWinnersPerLottery(3)
                ).to.be.revertedWith('Ownable: caller is not the owner');
                await expect(
                    lotteryContract.connect(randomUser)._setLotteryPeriod(3 * 24 * 3600)
                ).to.be.revertedWith('Ownable: caller is not the owner');
                await expect(
                    lotteryContract.connect(randomUser)._setLotteryDelay(24 * 3600)
                ).to.be.revertedWith('Ownable: caller is not the owner');
                await expect(
                    lotteryContract.connect(randomUser)._setlotteryNftRewardCount(3)
                ).to.be.revertedWith('Ownable: caller is not the owner');
                await expect(
                    lotteryContract.connect(randomUser).withdrawAccumulatedInterest()
                ).to.be.revertedWith('Ownable: caller is not the owner');
            })

            it("only admin should be able to change NFT contract controller", async () => {
                await expect(
                    nftContract.connect(randomUser).setController(randomUser.address)
                ).to.be.revertedWith('Ownable: caller is not the owner');
            })
        })
    });
