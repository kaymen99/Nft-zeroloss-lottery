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
  networkConfig,
} = require("../utils/helpers");

const lotteryStatus = { Open: 0, Closed: 1, Calculating_winner: 2 };

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

      const netConfig = networkConfig[network.config.chainId];
      const maxSupply = 10000;

      let lotteryParams = {
        nftRewardCount: 1,
        winnersPerRound: 1,
        delay: 3600, // 1 hour
        startTimestamp: 0,
        duration: 24 * 3600, // 1 day
        ticketPrice: getAmountInWei(100), // lottery ticket price = 100 DAI
      };

      before(async () => {
        [owner, user1, user2, user3, randomUser] = await ethers.getSigners();

        if (network.config.chainId == 31337) {
          [vrfCoordinatorMock, subscriptionId] =
            await deployVRFCoordinatorMock();
          vrfCoordinatorAddress = vrfCoordinatorMock.address;
          daiTokenMock = await deployERC20Mock();
          daiTokenAddress = daiTokenMock.address;
          aDaiTokenMock = await deployERC20Mock();
          aDaiTokenAddress = aDaiTokenMock.address;
          poolMock = await deployLendingPoolMock(aDaiTokenAddress);
          poolAddress = poolMock.address;
        } else {
          vrfCoordinatorAddress = netConfig["vrfCoordinatorV2"];
          subscriptionId = netConfig["subscriptionId"];
          daiTokenAddress = netConfig["daiAddress"];
          aDaiTokenAddress = netConfig["aDaiAddress"];
          poolAddress = netConfig["AAVELendingPool"];
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
            lotteryParams
          );

          // Set the lottery contract as the NFT mint controller
          await nftContract
            .connect(owner)
            .setController(lotteryContract.address);

          // Fund pool mock with aDai tokens
          await fundPoolWithADAI(owner, poolAddress, aDaiTokenAddress);
        });
        it("NFT contract should have correct owner address", async () => {
          const ownerAddress = await owner.getAddress();
          expect(await nftContract.owner()).to.equal(ownerAddress);
        });
        it("NFT contract should have correct initial parameters", async () => {
          expect(await nftContract.baseURI()).to.equal("");
          expect(await nftContract.maxSupply()).to.equal(maxSupply);
          expect(await nftContract.paused()).to.equal(1);

          await expect(nftContract.tokenURI(1)).to.be.revertedWithCustomError(
            nftContract,
            "NFTCollection__QueryForNonExistentToken"
          );
        });
        it("NFT Lottery contract should have correct owner address", async () => {
          const ownerAddress = await owner.getAddress();
          expect(await lotteryContract.owner()).to.equal(ownerAddress);
        });
        it("NFT Lottery contract should have correct initial parameters", async () => {
          let lotteryState = await lotteryContract.getLotteryState();

          expect(lotteryState.paused).to.equal(true);
          expect(lotteryState.status).to.equal(lotteryStatus["Closed"]);
          expect(lotteryState.nftRewardCount).to.be.equal(
            lotteryParams.nftRewardCount
          );
          expect(lotteryState.winnersPerRound).to.equal(
            lotteryParams.winnersPerRound
          );
          expect(lotteryState.delay).to.equal(lotteryParams.delay);
          expect(Number(lotteryState.startTimestamp)).to.equal(
            lotteryParams.startTimestamp
          );
          expect(Number(lotteryState.duration)).to.equal(
            lotteryParams.duration
          );
          expect(lotteryState.ticketPrice).to.be.equal(
            lotteryParams.ticketPrice
          );
        });
        it("NFT Lottery contract should be set as NFTCollection controller", async () => {
          expect(await nftContract.controller()).to.equal(
            lotteryContract.address
          );
        });
      });

      describe("Core Functions", () => {
        describe("Enter lottery function : enter()", () => {
          let entryAmount;
          before(async () => {
            // Deploy NFTCollection contract
            const NFTContract = await ethers.getContractFactory(
              "NFTCollection"
            );
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
              lotteryParams
            );

            // Set the lottery contract as the NFT mint controller
            await nftContract
              .connect(owner)
              .setController(lotteryContract.address);

            // Fund pool mock with aDai tokens
            await fundPoolWithADAI(owner, poolAddress, aDaiTokenAddress);
          });
          it("should allow user to enter lottery", async () => {
            // get user1 nft balance (must be zero as no nft was minted)
            const balance = await nftContract.balanceOf(user1.address);
            // Calculate user1 lottery entry price
            const entryPrice =
              getAmountFromWei(lotteryParams.ticketPrice) *
              (1 + Number(balance));
            entryAmount = getAmountInWei(entryPrice);

            await mintAndApproveDai(
              user1,
              daiTokenAddress,
              2000, // 2000 DAI
              lotteryContract.address,
              entryAmount
            );

            const tx = await lotteryContract.connect(user1).enter();
            let txReceipt = await tx.wait(1);

            const enterEvent =
              txReceipt.events[txReceipt.events.length - 1].args;
            expect(enterEvent.account).to.equal(user1.address);
            expect(enterEvent.amount).to.equal(entryAmount);
          });
          it("should add new participant to the lottery", async () => {
            const participants = await lotteryContract.getParticipantsList();
            expect(participants.length).to.equal(1);
            expect(participants[0]).to.equal(user1.address);
          });
          it("lottery should have correct DAI deposited balance", async () => {
            expect(await lotteryContract.lotteryDAIBalance()).to.equal(
              entryAmount
            );
          });
          it("lottery should have correct aDAI balance", async () => {
            const aDai = await ethers.getContractAt(
              "IERC20Mock",
              aDaiTokenAddress
            );
            const aDaiBalance = await aDai.balanceOf(lotteryContract.address);
            expect(aDaiBalance).to.be.greaterThanOrEqual(entryAmount);
          });
          it("should revert if user is already a participant", async () => {
            await expect(
              lotteryContract.connect(user1).enter()
            ).to.be.revertedWithCustomError(
              lotteryContract,
              "Lottery__AlreadyInParticipants"
            );
          });
          it("should revert if user has insuffisant DAI amount", async () => {
            // user2 has 0 DAI
            await expect(
              lotteryContract.connect(user2).enter()
            ).to.be.revertedWith("ERC20: insufficient allowance");
          });
        });

        describe("Quit lottery function : quit()", () => {
          let user1_daiBalance;
          let entryAmount;
          before(async () => {
            // Deploy NFTCollection contract
            const NFTContract = await ethers.getContractFactory(
              "NFTCollection"
            );
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
              lotteryParams
            );

            // Set the lottery contract as the NFT mint controller
            await nftContract
              .connect(owner)
              .setController(lotteryContract.address);

            // Fund pool mock with aDai tokens
            await fundPoolWithADAI(owner, poolAddress, aDaiTokenAddress);
          });
          it("should allow user to quit lottery", async () => {
            // calculate DAI amount returned to user1 which is equal to his entryPrice
            const balance = await nftContract.balanceOf(user1.address);
            const entryPrice =
              getAmountFromWei(lotteryParams.ticketPrice) *
              (1 + Number(balance));
            entryAmount = getAmountInWei(entryPrice);

            await mintAndApproveDai(
              user1,
              daiTokenAddress,
              2000, // 2000 DAI
              lotteryContract.address,
              entryAmount
            );
            await lotteryContract.connect(user1).enter();

            // Get user1 DAI balance before quiting
            const dai = await ethers.getContractAt(
              "IERC20Mock",
              daiTokenAddress
            );
            user1_daiBalance = await dai.balanceOf(user1.address);

            const tx = await lotteryContract.connect(user1).quit();
            let txReceipt = await tx.wait(1);

            const quitEvent =
              txReceipt.events[txReceipt.events.length - 1].args;
            expect(quitEvent.account).to.equal(user1.address);
            expect(quitEvent.amount).to.equal(entryAmount);
          });
          it("should return total entry price to user", async () => {
            // Get user1 DAI balance after quiting
            const dai = await ethers.getContractAt(
              "IERC20Mock",
              daiTokenAddress
            );
            const user1_daiBalance_after = await dai.balanceOf(user1.address);
            expect(getAmountFromWei(user1_daiBalance_after)).to.equal(
              getAmountFromWei(user1_daiBalance) + getAmountFromWei(entryAmount)
            );
          });
          it("should reset participants list if last participant has quited", async () => {
            const participants = await lotteryContract.getParticipantsList();
            expect(participants.length).to.equal(0);
          });
          it("should update DAI deposited balance", async () => {
            expect(await lotteryContract.lotteryDAIBalance()).to.equal(0);
          });
          it("should remove user from participants list", async () => {
            // Get entry cost for new users
            const entryCost = (await lotteryContract.getLotteryState())
              .ticketPrice;
            await mintAndApproveDai(
              user1,
              daiTokenAddress,
              1000, // 1000 DAI
              lotteryContract.address,
              entryCost
            );
            await lotteryContract.connect(user1).enter();

            await mintAndApproveDai(
              user2,
              daiTokenAddress,
              1000, // 1000 DAI
              lotteryContract.address,
              entryCost
            );
            await lotteryContract.connect(user2).enter();

            await mintAndApproveDai(
              user3,
              daiTokenAddress,
              1000, // 1000 DAI
              lotteryContract.address,
              entryCost
            );
            await lotteryContract.connect(user3).enter();

            let participants = await lotteryContract.getParticipantsList();
            expect(participants.length).to.equal(3);
            expect(participants).to.have.members([
              user1.address,
              user2.address,
              user3.address,
            ]);

            await lotteryContract.connect(user2).quit();

            // Check that remove function work correctely
            participants = await lotteryContract.getParticipantsList();
            expect(participants.length).to.equal(2);
            expect(participants).to.have.members([
              user1.address,
              user3.address,
            ]);
          });
        });

        describe("checkUpkeep()", function () {
          before(async () => {
            // Deploy NFTCollection contract
            const NFTContract = await ethers.getContractFactory(
              "NFTCollection"
            );
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
              lotteryParams
            );

            // Set the lottery contract as the NFT mint controller
            await nftContract
              .connect(owner)
              .setController(lotteryContract.address);

            // Fund pool mock with aDai tokens
            await fundPoolWithADAI(owner, poolAddress, aDaiTokenAddress);
          });

          describe("open lottery checkUpkeep", function () {
            // upkeepNeeded = (isClosed && isNotPaused)
            it("returns false if lottery is paused", async () => {
              const { upkeepNeeded } =
                await lotteryContract.callStatic.checkUpkeep("0x01");
              expect(upkeepNeeded).to.equal(false);
            });
            it("returns true if lottery is closed and not paused", async () => {
              // unpause lottery
              await lotteryContract.connect(owner).pause(false);
              const { upkeepNeeded } =
                await lotteryContract.callStatic.checkUpkeep("0x01");
              expect(upkeepNeeded).to.equal(true);
            });
          });

          describe("close lottery checkUpkeep", function () {
            // upkeepNeeded = (isOpen && lotteryPeriodEnded && hasParticipants);
            it("returns false if lottery isn't open", async () => {
              const { upkeepNeeded } =
                await lotteryContract.callStatic.checkUpkeep("0x02");
              expect(upkeepNeeded).to.equal(false);
            });
            it("returns false if lottery period hasn't ended", async () => {
              // performupkeep to open lottery
              await lotteryContract.performUpkeep("0x01");

              // skip  5 hours
              await moveTime(5 * 3600);

              // check close lottery upkeep
              const { upkeepNeeded } =
                await lotteryContract.callStatic.checkUpkeep("0x02");
              expect(upkeepNeeded).to.equal(false);
            });
            it("returns false if lottery has no participant", async () => {
              // skip 24 hours to end lottery period
              await moveTime(24 * 3600);

              // check close lottery upkeep
              const { upkeepNeeded } =
                await lotteryContract.callStatic.checkUpkeep("0x02");
              expect(upkeepNeeded).to.equal(false);
            });
            it("returns true if lottery close conditions are met", async () => {
              const balance = await nftContract.balanceOf(user1.address);
              const entryPrice =
                getAmountFromWei(lotteryParams.ticketPrice) *
                (1 + Number(balance));

              // add at least one participant
              await mintAndApproveDai(
                user1,
                daiTokenAddress,
                2000, // 2000 DAI
                lotteryContract.address,
                getAmountInWei(entryPrice)
              );
              await lotteryContract.connect(user1).enter();

              // check close lottery upkeep
              const { upkeepNeeded } =
                await lotteryContract.callStatic.checkUpkeep("0x02");
              expect(upkeepNeeded).to.equal(true);
            });
          });
        });

        describe("performUpkeep()", function () {
          before(async () => {
            // Deploy NFTCollection contract
            const NFTContract = await ethers.getContractFactory(
              "NFTCollection"
            );
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
              lotteryParams
            );

            // Set the lottery contract as the NFT mint controller
            await nftContract
              .connect(owner)
              .setController(lotteryContract.address);

            // Fund pool mock with aDai tokens
            await fundPoolWithADAI(owner, poolAddress, aDaiTokenAddress);
          });
          it("should only run if checkupkeep returns true", async () => {
            // upkeepNeeded = (isClosed && isNotPaused)
            const upkeep1 = await lotteryContract.callStatic.checkUpkeep(
              "0x01"
            );
            expect(upkeep1.upkeepNeeded).to.equal(false);

            // Try to performupkeep to open lottery
            await expect(
              lotteryContract.performUpkeep("0x01")
            ).to.be.revertedWithCustomError(
              lotteryContract,
              "NFTLottery__UpkeepNotNeeded"
            );

            // upkeepNeeded = (isOpen && lotteryPeriodEnded && hasParticipants)
            const upkeep2 = await lotteryContract.callStatic.checkUpkeep(
              "0x02"
            );
            expect(upkeep2.upkeepNeeded).to.equal(false);

            // Try to performupkeep to close lottery
            await expect(
              lotteryContract.performUpkeep("0x02")
            ).to.be.revertedWithCustomError(
              lotteryContract,
              "NFTLottery__UpkeepNotNeeded"
            );
          });
          let openTime;
          let startTime;
          let txReceipt;
          describe("open lottery upkeep", function () {
            it("should open change the lottery state to Open", async () => {
              // unpause lottery
              await lotteryContract.connect(owner).pause(false);

              expect((await lotteryContract.getLotteryState()).paused).to.equal(
                false
              );

              // upkeepNeeded = (isClosed && isNotPaused)
              const { upkeepNeeded } =
                await lotteryContract.callStatic.checkUpkeep("0x01");
              expect(upkeepNeeded).to.equal(true);

              // Try to performupkeep to open lottery
              const tx = await lotteryContract.performUpkeep("0x01");
              let txReceipt = await tx.wait(1);

              openTime = Number(txReceipt.events[0].args.timestamp);
              startTime = Number(txReceipt.events[0].args.start);

              expect(
                (await lotteryContract.getLotteryState()).status
              ).to.be.equal(lotteryStatus["Open"]);
            });
            it("should update the lottery start timestamp", async () => {
              const delay = (await lotteryContract.getLotteryState()).delay;
              const expectedOpenTimstamp = openTime + Number(delay);

              expect(
                (await lotteryContract.getLotteryState()).startTimestamp
              ).to.be.equal(expectedOpenTimstamp);
              expect(
                (await lotteryContract.getLotteryState()).startTimestamp
              ).to.be.equal(startTime);
            });
          });
          describe("close lottery upkeep", function () {
            before(async () => {
              // add three particpant
              const entryCost = (await lotteryContract.getLotteryState())
                .ticketPrice;
              await mintAndApproveDai(
                user1,
                daiTokenAddress,
                1000, // 1000 DAI
                lotteryContract.address,
                entryCost
              );
              await lotteryContract.connect(user1).enter();

              await mintAndApproveDai(
                user2,
                daiTokenAddress,
                1000, // 1000 DAI
                lotteryContract.address,
                entryCost
              );
              await lotteryContract.connect(user2).enter();

              await mintAndApproveDai(
                user3,
                daiTokenAddress,
                1000, // 1000 DAI
                lotteryContract.address,
                entryCost
              );
              await lotteryContract.connect(user3).enter();

              // pass time to end lottery period
              // 25 hours = 24h lottery period + 1h lottery start delay
              await moveTime(25 * 3600);
            });

            it("should emit closed lottery event", async () => {
              // close lottery
              const tx = await lotteryContract.performUpkeep("0x02");
              txReceipt = await tx.wait(1);
              const CloseEvent = txReceipt.events[0];
              expect(CloseEvent.event).to.be.equal("Lottery__IsClosed");
              expect(
                Number(CloseEvent.args.timestamp)
              ).to.be.greaterThanOrEqual(openTime + 25 * 3600);
            });
            it("should change lottery state to calculating winner", async () => {
              expect(
                (await lotteryContract.getLotteryState()).status
              ).to.be.equal(lotteryStatus["Calculating_winner"]);
            });
            it("should emit request winners event", async () => {
              const RequestWinnersEvent = txReceipt.events[2];

              expect(RequestWinnersEvent.event).to.be.equal(
                "Lottery__RequestWinners"
              );
              expect(
                Number(RequestWinnersEvent.args.requestId)
              ).to.be.greaterThanOrEqual(1);
            });
          });
        });

        describe("fulfillRandomWords()", function () {
          before(async () => {
            // Deploy NFTCollection contract
            const NFTContract = await ethers.getContractFactory(
              "NFTCollection"
            );
            nftContract = await NFTContract.deploy(maxSupply);

            if (network.config.chainId == 31337) {
              [vrfCoordinatorMock, subscriptionId] =
                await deployVRFCoordinatorMock();
              vrfCoordinatorAddress = vrfCoordinatorMock.address;
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
              lotteryParams
            );

            // Set the lottery contract as the NFT mint controller
            await nftContract
              .connect(owner)
              .setController(lotteryContract.address);

            // unpause NFT contract
            await nftContract.connect(owner).pause(2);

            // Fund pool mock with aDai tokens
            await fundPoolWithADAI(owner, poolAddress, aDaiTokenAddress);

            // set number of winners per lottery to 2 for testing
            await lotteryContract.connect(owner)._setWinnersPerLottery(2);

            // unpause lottery
            await lotteryContract.connect(owner).pause(false);

            // open lottery
            await lotteryContract.performUpkeep("0x01");

            // add three particpant
            const entryCost = (await lotteryContract.getLotteryState())
              .ticketPrice;
            await mintAndApproveDai(
              user1,
              daiTokenAddress,
              1000, // 1000 DAI
              lotteryContract.address,
              entryCost
            );
            await lotteryContract.connect(user1).enter();

            await mintAndApproveDai(
              user2,
              daiTokenAddress,
              1000, // 1000 DAI
              lotteryContract.address,
              entryCost
            );
            await lotteryContract.connect(user2).enter();

            await mintAndApproveDai(
              user3,
              daiTokenAddress,
              1000, // 1000 DAI
              lotteryContract.address,
              entryCost
            );
            await lotteryContract.connect(user3).enter();

            // pass time to end lottery period
            // 25 hours = 24h lottery period + 1h lottery start delay
            await moveTime(25 * 3600);
          });
          it("should only be called after performupkeep", async () => {
            await expect(
              vrfCoordinatorMock.fulfillRandomWords(0, lotteryContract.address)
            ).to.be.revertedWith("nonexistent request");
            await expect(
              vrfCoordinatorMock.fulfillRandomWords(1, lotteryContract.address)
            ).to.be.revertedWith("nonexistent request");
          });
          let participantsList, winnersList;
          let aDai, lotteryDAIBalance, lotteryaDAIBalance;
          it("should calculate lottery winners when receiving random numbers from Chainlink VRF", async () => {
            await new Promise(async (resolve, reject) => {
              lotteryContract.once(
                "Lottery__WinnersPicked",
                async (winners, reward, timestamp, winnerPickedEvent) => {
                  try {
                    // Check that correct event is emitted
                    expect(winnerPickedEvent.event).to.be.equal(
                      "Lottery__WinnersPicked"
                    );
                    winnersList = winners;
                    expect(winners.length).to.be.equal(
                      (await lotteryContract.getLotteryState()).winnersPerRound
                    );
                    expect(reward).to.be.equal(
                      (await lotteryContract.getLotteryState()).nftRewardCount
                    );
                  } catch (e) {
                    reject(e);
                  }
                  resolve();
                }
              );
              // Get lottery deposited DAI balnace
              lotteryDAIBalance = await lotteryContract.lotteryDAIBalance();

              // Get lottery initial aDAI balnace
              aDai = await ethers.getContractAt("IERC20Mock", aDaiTokenAddress);
              lotteryaDAIBalance = await aDai.balanceOf(
                lotteryContract.address
              );

              // Get participant list
              participantsList = await lotteryContract.getParticipantsList();

              // close lottery
              const tx = await lotteryContract.performUpkeep("0x02");
              const txReceipt = await tx.wait(1);

              const _requestId = Number(txReceipt.events[2].args.requestId);
              await vrfCoordinatorMock.fulfillRandomWords(
                _requestId,
                lotteryContract.address
              );
            });
          });
          it("winners should be picked from the participant list", async () => {
            expect(participantsList).to.include(winnersList[0]);
            expect(participantsList).to.include(winnersList[1]);
          });
          it("should send NFTs reward to the winners", async () => {
            const lotteryReward = (await lotteryContract.getLotteryState())
              .nftRewardCount;
            expect(await nftContract.balanceOf(winnersList[0])).to.be.equal(
              lotteryReward
            );
            expect(await nftContract.balanceOf(winnersList[1])).to.be.equal(
              lotteryReward
            );
          });
          it("should return DAI entry amount to winners", async () => {
            expect(await lotteryContract.lotteryDAIBalance()).to.be.lessThan(
              lotteryDAIBalance
            );
            expect(
              await aDai.balanceOf(lotteryContract.address)
            ).to.be.lessThan(lotteryaDAIBalance);
          });
          it("should change lottery state to Closed & update participant list", async () => {
            const _participantsList =
              await lotteryContract.getParticipantsList();
            expect(_participantsList.length).to.be.equal(
              participantsList.length - winnersList.length
            );
            expect(
              (await lotteryContract.getLotteryState()).status
            ).to.be.equal(lotteryStatus["Closed"]);
          });
        });
      });

      describe("Update Functions", () => {
        beforeEach(async () => {
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
            lotteryParams
          );

          // Set the lottery contract as the NFT mint controller
          await nftContract
            .connect(owner)
            .setController(lotteryContract.address);

          // Fund pool mock with aDai tokens
          await fundPoolWithADAI(owner, poolAddress, aDaiTokenAddress);
        });
        it("should allow owner to change lottery parameters when in paused state", async () => {
          const newPeriod = 3 * 24 * 3600; // 3 days
          let tx = await lotteryContract
            .connect(owner)
            ._setLotteryDuration(newPeriod);
          let txReceipt = await tx.wait(1);

          const periodChangedEvent = txReceipt.events[0];
          expect(periodChangedEvent.event).to.equal("Lottery__DurationChanged");
          expect(Number(periodChangedEvent.args.duration)).to.equal(newPeriod);

          tx = await lotteryContract
            .connect(owner)
            ._setlotteryNftRewardCount(3);
          txReceipt = await tx.wait(1);

          const rewardChangedEvent = txReceipt.events[0];
          expect(rewardChangedEvent.event).to.equal(
            "Lottery__NftRewardCountChanged"
          );
          expect(Number(rewardChangedEvent.args.nftCount)).to.equal(3);
        });
        it("should not allow owner to change lottery parameters when not in paused state", async () => {
          // unpause lottery
          await lotteryContract.connect(owner).pause(false);

          // try to change lottery period
          const newPeriod = 3 * 24 * 3600; // 3 days
          await expect(
            lotteryContract.connect(owner)._setLotteryDuration(newPeriod)
          ).to.be.revertedWithCustomError(
            lotteryContract,
            "Lottery__ChangesNotAllowed"
          );

          // try to change NFT reward
          await expect(
            lotteryContract.connect(owner)._setlotteryNftRewardCount(3)
          ).to.be.revertedWithCustomError(
            lotteryContract,
            "Lottery__ChangesNotAllowed"
          );
        });
        it("should not allow owner to change lottery parameters when lottery is in Open state", async () => {
          // unpause lottery
          await lotteryContract.connect(owner).pause(false);

          // open lottery
          await lotteryContract.performUpkeep("0x01");

          // pause lottery contract but let it open for the current lottery
          await lotteryContract.connect(owner).pause(true);

          // try to change lottery period
          const newPeriod = 3 * 24 * 3600; // 3 days
          await expect(
            lotteryContract.connect(owner)._setLotteryDuration(newPeriod)
          ).to.be.revertedWithCustomError(
            lotteryContract,
            "Lottery__ChangesNotAllowed"
          );

          // try to change NFT reward
          await expect(
            lotteryContract.connect(owner)._setlotteryNftRewardCount(3)
          ).to.be.revertedWithCustomError(
            lotteryContract,
            "Lottery__ChangesNotAllowed"
          );
        });
      });

      describe("Admin Functions", () => {
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
            lotteryParams
          );

          // Set the lottery contract as the NFT mint controller
          await nftContract
            .connect(owner)
            .setController(lotteryContract.address);

          // Fund pool mock with aDai tokens
          await fundPoolWithADAI(owner, poolAddress, aDaiTokenAddress);
        });
        it("only admin should be allowed to change NFT Lottery contract parametres & withdraw gains", async () => {
          await expect(
            lotteryContract.connect(randomUser).pause(2)
          ).to.be.revertedWith("Ownable: caller is not the owner");
          await expect(
            lotteryContract
              .connect(randomUser)
              ._setLotteryTicketBasePrice(getAmountInWei(200))
          ).to.be.revertedWith("Ownable: caller is not the owner");
          await expect(
            lotteryContract.connect(randomUser)._setWinnersPerLottery(3)
          ).to.be.revertedWith("Ownable: caller is not the owner");
          await expect(
            lotteryContract
              .connect(randomUser)
              ._setLotteryDuration(3 * 24 * 3600)
          ).to.be.revertedWith("Ownable: caller is not the owner");
          await expect(
            lotteryContract.connect(randomUser)._setLotteryDelay(24 * 3600)
          ).to.be.revertedWith("Ownable: caller is not the owner");
          await expect(
            lotteryContract.connect(randomUser)._setlotteryNftRewardCount(3)
          ).to.be.revertedWith("Ownable: caller is not the owner");
          await expect(
            lotteryContract.connect(randomUser).withdrawAccumulatedInterest()
          ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("only admin should be able to change NFT contract controller", async () => {
          await expect(
            nftContract.connect(randomUser).setController(randomUser.address)
          ).to.be.revertedWith("Ownable: caller is not the owner");
        });
      });
    });
