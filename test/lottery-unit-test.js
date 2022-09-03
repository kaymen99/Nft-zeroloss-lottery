const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { getAmountInWei, getAmountFromWei, developmentChains, networkConfig, mintAndApproveDai, moveTime } = require('../utils/helpers');


const lotteryStates = { "Open": 0, "Closed": 1, "Calculating_winner": 2 }

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("NFT Lottery", () => {
        let owner;
        let lotteryContract;
        let nftContract;

        const netConfig = networkConfig[network.config.chainId]
        const maxSupply = 10000
        const ticketPrice = 100 // lottery ticket price = 100 DAI

        before(async () => {
            [owner, user1, user2, user3] = await ethers.getSigners()
        });

        describe("Correct Deployement", () => {
            before(async () => {
                // Deploy NFTCollection contract 
                const NFTContract = await ethers.getContractFactory("NFTCollection");
                nftContract = await NFTContract.deploy(maxSupply);

                // Deploy NFTLottery contract 
                const Lottery = await ethers.getContractFactory("NFTLottery");
                lotteryContract = await Lottery.deploy(
                    netConfig["vrfcoordinator"],
                    netConfig["linkAddress"],
                    getAmountInWei(netConfig["fee"]),
                    netConfig["keyHash"],
                    netConfig["daiAddress"],
                    netConfig["aDaiAddress"],
                    netConfig["AAVELendingPool"],
                    nftContract.address,
                    getAmountInWei(ticketPrice)
                );

                // Set the lottery contract as the NFT mint controller
                await nftContract.connect(owner).setController(lotteryContract.address)
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
                expect(await lotteryContract.fee()).to.equal(getAmountInWei(netConfig["fee"]));
                // expect(await lotteryContract.keyhash()).to.equal(netConfig["keyHash"]);
                expect(await lotteryContract.getLotteryState()).to.be.equal(lotteryStates["Closed"]);
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
                        netConfig["vrfcoordinator"],
                        netConfig["linkAddress"],
                        getAmountInWei(netConfig["fee"]),
                        netConfig["keyHash"],
                        netConfig["daiAddress"],
                        netConfig["aDaiAddress"],
                        netConfig["AAVELendingPool"],
                        nftContract.address,
                        getAmountInWei(ticketPrice)
                    );

                    // Set the lottery contract as the NFT mint controller
                    await nftContract.connect(owner).setController(lotteryContract.address)
                });
                it("should allow user to enter lottery", async () => {
                    // get user1 nft balance (must be zero as no nft was minted)
                    const balance = await nftContract.balanceOf(user1.address)
                    // Calculate user1 lottery entry price
                    const entryPrice = ticketPrice * (1 + Number(balance))
                    entryAmount = getAmountInWei(entryPrice)

                    await mintAndApproveDai(
                        user1,
                        1,
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
                    const aDai = await ethers.getContractAt("IERC20", netConfig["aDaiAddress"])
                    const aDaiBalance = await aDai.balanceOf(lotteryContract.address)

                    expect(aDaiBalance).to.be.greaterThanOrEqual(entryAmount);
                });
                it("should revert if user is already a participant", async () => {
                    await expect(lotteryContract.connect(user1).enter()).to.be.revertedWithCustomError(lotteryContract, 'Lottery__AlreadyInParticipants');
                });
                it("should revert if user has insuffisant DAI amount", async () => {
                    // user2 has 0 DAI
                    await expect(lotteryContract.connect(user2).enter()).to.be.revertedWith('Dai/insufficient-balance');
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
                        netConfig["vrfcoordinator"],
                        netConfig["linkAddress"],
                        getAmountInWei(netConfig["fee"]),
                        netConfig["keyHash"],
                        netConfig["daiAddress"],
                        netConfig["aDaiAddress"],
                        netConfig["AAVELendingPool"],
                        nftContract.address,
                        getAmountInWei(ticketPrice)
                    );

                    // Set the lottery contract as the NFT mint controller
                    await nftContract.connect(owner).setController(lotteryContract.address)
                });
                it("should allow user to quit lottery", async () => {
                    // calculate DAI amount returned to user1 which is equal to his entryPrice
                    const balance = await nftContract.balanceOf(user1.address)
                    const entryPrice = ticketPrice * (1 + Number(balance))
                    entryAmount = getAmountInWei(entryPrice)

                    await mintAndApproveDai(
                        user1,
                        1,
                        lotteryContract.address,
                        entryAmount
                    )
                    await lotteryContract.connect(user1).enter()

                    // Get user1 DAI balance before quiting
                    const dai = await ethers.getContractAt("IERC20", netConfig["daiAddress"])
                    user1_daiBalance = await dai.balanceOf(user1.address)

                    const tx = await lotteryContract.connect(user1).quit()
                    let txReceipt = await tx.wait(1)

                    const quitEvent = txReceipt.events[txReceipt.events.length - 1].args
                    expect(quitEvent.account).to.equal(user1.address);
                    expect(quitEvent.amount).to.equal(entryAmount);
                });
                it("should return total entry price to user", async () => {
                    // Get user1 DAI balance after quiting
                    const dai = await ethers.getContractAt("IERC20", netConfig["daiAddress"])
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
                    const participantsList = [user1, user2, user3]
                    for (let i = 0; i < participantsList.length; i++) {
                        await mintAndApproveDai(
                            participantsList[i],
                            1,
                            lotteryContract.address,
                            entryCost
                        )
                        await lotteryContract.connect(participantsList[i]).enter()
                    }

                    const participants = await lotteryContract.getParticipantsList()
                    expect(participants.length).to.equal(3);
                    expect(participants).to.have.members(participantsList)

                    await lotteryContract.connect(user2).quit()

                    // Check that remove function work correctely
                    participants = await lotteryContract.getParticipantsList()
                    expect(participants.length).to.equal(2);
                    expect(participants).to.have.members([user1, user3])
                });
            })

            describe("lottery checkUpkeep function", function () {
                before(async () => {
                    // Deploy NFTCollection contract 
                    const NFTContract = await ethers.getContractFactory("NFTCollection");
                    nftContract = await NFTContract.deploy(maxSupply);

                    // Deploy NFTLottery contract 
                    const Lottery = await ethers.getContractFactory("NFTLottery");
                    lotteryContract = await Lottery.deploy(
                        netConfig["vrfcoordinator"],
                        netConfig["linkAddress"],
                        getAmountInWei(netConfig["fee"]),
                        netConfig["keyHash"],
                        netConfig["daiAddress"],
                        netConfig["aDaiAddress"],
                        netConfig["AAVELendingPool"],
                        nftContract.address,
                        getAmountInWei(ticketPrice)
                    );

                    // Set the lottery contract as the NFT mint controller
                    await nftContract.connect(owner).setController(lotteryContract.address)

                    const delay = 4 * 3600 // 4 hours
                    const period = 10 * 24 * 3600 // 10 days

                    // Set the lottery period and delay
                    await lotteryContract.connect(owner)._setLotteryDelay(delay)
                    await lotteryContract.connect(owner)._setLotteryPeriod(period)
                });

                describe("open lottery checkUpkeep", function () {
                    it("returns false if lottery is paused", async () => {
                        // upkeepNeeded = (isClosed && isNotPaused)
                        const { upkeepNeeded } = await lotteryContract.callStatic.checkUpkeep("0x01")
                        expect(upkeepNeeded).to.equal(false);
                    })
                    it("returns true if lottery is closed and not paused", async () => {
                        // unpause lottery 
                        await lotteryContract.connect(owner).pause(2)

                        // upkeepNeeded = (isOpen && lotteryPeriodEnded && hasParticipants);
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

                        // skip 5 days
                        await moveTime(5 * 24 * 3600)

                        // check close lottery upkeep
                        const { upkeepNeeded } = await lotteryContract.callStatic.checkUpkeep("0x02")
                        expect(upkeepNeeded).to.equal(false);
                    })
                    it("returns false if lottery has not participant", async () => {
                        // skip 7 days to end lottery period
                        await moveTime(7 * 24 * 3600)

                        // check close lottery upkeep
                        const { upkeepNeeded } = await lotteryContract.callStatic.checkUpkeep("0x02")
                        expect(upkeepNeeded).to.equal(false);
                    })

                    it("returns true if lottery close conditions are met", async () => {
                        const balance = await nftContract.balanceOf(user1.address)
                        const entryPrice = ticketPrice * (1 + Number(balance))

                        await mintAndApproveDai(
                            user1,
                            1,
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
        });

    });
