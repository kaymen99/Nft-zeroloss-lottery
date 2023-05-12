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

const lotteryStates = { Open: 0, Closed: 1, Calculating_winner: 2 };

!developmentChains.includes(network.name)
  ? describe.skip
  : describe("NFT Lottery End2End Tests", () => {
      let owner;
      let lotteryContract;
      let nftContract;
      let daiTokenMock, daiTokenAddress;
      let aDaiTokenMock, aDaiTokenAddress;
      let subscriptionId;
      let poolMock, poolAddress;
      let vrfCoordinatorMock, vrfCoordinatorAddress;

      const netConfig = networkConfig[network.config.chainId];
      const maxSupply = 10000;
      let lotteryParams = {
        nftRewardCount: 1,
        winnersPerRound: 2,
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
        await nftContract.connect(owner).setController(lotteryContract.address);

        // unpause NFT contract
        await nftContract.connect(owner).pause(2);

        // Fund pool mock with aDai tokens
        await fundPoolWithADAI(owner, poolAddress, aDaiTokenAddress);
      });
      it("should start the lottery when not paused", async () => {
        // unpause lottery
        await lotteryContract.connect(owner).pause(false);

        // upkeepNeeded = (isClosed && isNotPaused)
        const { upkeepNeeded } = await lotteryContract.callStatic.checkUpkeep(
          "0x01"
        );
        expect(upkeepNeeded).to.equal(true);

        // performupkeep to open lottery
        await lotteryContract.performUpkeep("0x01");
        expect((await lotteryContract.getLotteryState()).status).to.be.equal(
          lotteryStates["Open"]
        );
      });
      it("should allow users to enter the lottery", async () => {
        // add three particpant
        const entryCost = (await lotteryContract.getLotteryState()).ticketPrice;
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

        const participantsList = await lotteryContract.getParticipantsList();
        expect(participantsList.length).to.equal(3);
        expect(participantsList).to.have.members([
          user1.address,
          user2.address,
          user3.address,
        ]);

        const aDai = await ethers.getContractAt("IERC20Mock", aDaiTokenAddress);
        const lotteryaDAIBalance = await aDai.balanceOf(
          lotteryContract.address
        );
        expect(getAmountFromWei(lotteryaDAIBalance)).to.be.equal(
          3 * getAmountFromWei(entryCost)
        );

        const lotteryDAIBalance = await lotteryContract.lotteryDAIBalance();
        expect(getAmountFromWei(lotteryDAIBalance)).to.be.equal(
          3 * getAmountFromWei(entryCost)
        );
      });
      let closetxReceipt;
      it("should calculate winners after lottery period ends", async () => {
        // pass time to end lottery period
        // 25 hours = 24h lottery period + 1h lottery start delay
        await moveTime(25 * 3600);
        // close lottery
        const closetx = await lotteryContract.performUpkeep("0x02");
        closetxReceipt = await closetx.wait(1);
        expect((await lotteryContract.getLotteryState()).status).to.be.equal(
          lotteryStates["Calculating_winner"]
        );
      });
      it("should emit a request to Chainlink VRF to get random winners Ids", async () => {
        const RequestWinnersEvent = closetxReceipt.events[2];

        expect(RequestWinnersEvent.event).to.be.equal(
          "Lottery__RequestWinners"
        );
        expect(Number(RequestWinnersEvent.args.requestId)).to.be.equal(1);
      });
      it("should pick lottery winners, send them NFTs, return DAI entry amount, and change lottery state to Closed", async () => {
        let participantsList;
        let aDai, lotteryDAIBalance, lotteryaDAIBalance;
        await new Promise(async (resolve, reject) => {
          lotteryContract.once(
            "Lottery__WinnersPicked",
            async (winners, reward, timestamp, winnerPickedEvent) => {
              try {
                const lotteryReward = (await lotteryContract.getLotteryState())
                  .nftRewardCount;
                // Check that correct event is emitted
                expect(winnerPickedEvent.event).to.be.equal(
                  "Lottery__WinnersPicked"
                );
                expect(winners.length).to.be.equal(
                  Number(
                    (await lotteryContract.getLotteryState()).winnersPerRound
                  )
                );
                expect(reward).to.be.equal(lotteryReward);

                // Check that winners recieved correct NFT rewards
                expect(participantsList).to.include(winners[0]);
                expect(participantsList).to.include(winners[1]);
                expect(await nftContract.balanceOf(winners[0])).to.be.equal(
                  lotteryReward
                );
                expect(await nftContract.balanceOf(winners[1])).to.be.equal(
                  lotteryReward
                );

                // Check that DAI & aDAI balances are updated after DAI entry funds transfer to winners
                expect(
                  await lotteryContract.lotteryDAIBalance()
                ).to.be.lessThan(lotteryDAIBalance);
                expect(
                  await aDai.balanceOf(lotteryContract.address)
                ).to.be.lessThan(lotteryaDAIBalance);

                // Check lottery state & participants list have been updated
                const _participantsList =
                  await lotteryContract.getParticipantsList();
                expect(_participantsList.length).to.be.equal(
                  participantsList.length - winners.length
                );
                expect(
                  (await lotteryContract.getLotteryState()).status
                ).to.be.equal(lotteryStates["Closed"]);
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
          lotteryaDAIBalance = await aDai.balanceOf(lotteryContract.address);

          // Get participant list
          participantsList = await lotteryContract.getParticipantsList();

          const _requestId = Number(closetxReceipt.events[2].args.requestId);
          await vrfCoordinatorMock.fulfillRandomWords(
            _requestId,
            lotteryContract.address
          );
        });
      });
      it("should automatically reopen the lottery", async () => {
        // upkeepNeeded = (isClosed && isNotPaused)
        const { upkeepNeeded } = await lotteryContract.callStatic.checkUpkeep(
          "0x01"
        );
        expect(upkeepNeeded).to.equal(true);

        //  performupkeep to open lottery
        await lotteryContract.performUpkeep("0x01");

        expect((await lotteryContract.getLotteryState()).status).to.be.equal(
          lotteryStates["Open"]
        );
      });
      it("old winners should pay higher entrance fee", async () => {
        const aDai = await ethers.getContractAt("IERC20Mock", aDaiTokenAddress);

        const initialLotteryaDAIBalance = await aDai.balanceOf(
          lotteryContract.address
        );
        const initialLotteryDAIBalance =
          await lotteryContract.lotteryDAIBalance();

        const entryCost = (await lotteryContract.getLotteryState()).ticketPrice;
        const expected_entrance_fee = getAmountFromWei(entryCost) * 2;
        // for testing we use a mock vrf coordinator, so we now the picked winners
        await mintAndApproveDai(
          user1,
          daiTokenAddress,
          200, // 200 DAI
          lotteryContract.address,
          getAmountInWei(expected_entrance_fee)
        );
        await lotteryContract.connect(user1).enter();

        const finalLotteryDAIBalance =
          await lotteryContract.lotteryDAIBalance();
        const finalLotteryaDAIBalance = await aDai.balanceOf(
          lotteryContract.address
        );

        // check that correct DAI has been paid
        expect(getAmountFromWei(finalLotteryDAIBalance)).to.be.equal(
          getAmountFromWei(initialLotteryDAIBalance) + expected_entrance_fee
        );
        expect(getAmountFromWei(finalLotteryaDAIBalance)).to.be.equal(
          getAmountFromWei(initialLotteryaDAIBalance) + expected_entrance_fee
        );
      });
    });
