import { VotingManagerInstance, VotingRewardManagerInstance } from "../../../typechain-truffle";
import { toBN } from "../../utils/test-helpers";
import { MerkleTree } from "./MerkleTree";
import { RewardCalculatorForPriceEpoch } from "./RewardCalculatorForPriceEpoch";
import { ClaimReward, MedianCalculationResult } from "./voting-interfaces";
import { hashClaimReward } from "./voting-utils";

/**
 * Reward calculator for sequence of reward epochs.
 */
export class RewardCalculator {
  ////////////// Reward epoch settings //////////////
  // First rewarded price epoch
  firstRewardedPriceEpoch: number = 0;
  // Duration of the reward epoch in price epochs
  rewardEpochDurationInEpochs: number = 0;


  ////////////// Initial processing boundaries //////////////
  // First reward epoch to be processed
  initialRewardEpoch: number = 0;
  // First price epoch of the reward epoch 'initialRewardEpoch'.
  initialPriceEpoch: number = 0;

  ////////////// Progress counters //////////////
  // First price epoch of the next reward epoch in calculation. Used to determine when to move to the next reward epoch.
  firstPriceEpochInNextRewardEpoch: number = 0;
  // Next price epoch to be processed.
  currentUnprocessedPriceEpoch: number = 0;
  // Current reward epoch that is being processed.
  currentRewardEpoch: number = 0;

  ////////////// Claim data //////////////
  // priceEpochId => list of claims
  priceEpochClaims: Map<number, ClaimReward[]> = new Map<number, ClaimReward[]>();
  // rewardEpochId => list of cumulative claims
  rewardEpochCumulativeRewards: Map<number, ClaimReward[]> = new Map<number, ClaimReward[]>();

  ///////////// Contracts //////////////
  votingManager!: VotingManagerInstance;
  votingRewardManager!: VotingRewardManagerInstance;

  ///////////// IQR and PCT weights //////////////
  // Should be nominators of fractions with the same denominator. Eg. if in BIPS with denominator 100, then 30 means 30%
  // The sum should be equal to the intended denominator (100 in the example).
  // IQR weight
  iqrShare: BN = toBN(0);
  // PCT weight
  pctShare: BN = toBN(0);

  constructor(
    initialRewardEpoch: number,
    votingManager: VotingManagerInstance,
    votingRewardManager: VotingRewardManagerInstance,
    iqrShare: BN,
    pctShare: BN
  ) {
    this.initialRewardEpoch = initialRewardEpoch;
    this.votingManager = votingManager;
    this.votingRewardManager = votingRewardManager;
    this.iqrShare = iqrShare;
    this.pctShare = pctShare;
  }

  /**
   * Initializes the reward calculator.
   */
  async initialize() {
    // Epoch settings from smart contracts
    this.firstRewardedPriceEpoch = (await this.votingManager.firstRewardedPriceEpoch()).toNumber();
    this.rewardEpochDurationInEpochs = (await this.votingManager.rewardEpochDurationInEpochs()).toNumber();

    // Initial processing boundaries
    this.initialPriceEpoch = this.firstRewardedPriceEpoch + this.rewardEpochDurationInEpochs * this.initialRewardEpoch;
    
    // Progress counters initialization
    this.currentUnprocessedPriceEpoch = this.initialPriceEpoch;
    this.currentRewardEpoch = this.initialRewardEpoch;
    this.firstPriceEpochInNextRewardEpoch = this.initialPriceEpoch + this.rewardEpochDurationInEpochs;
  }

  /**
   * Calculates the claims for the given price epoch.
   * These claims are then stored for each price epoch in the priceEpochClaims map.
   * During each reward epoch the claims are incrementally merged into cumulative claims for the reward epoch
   * which are stored in the rewardEpochCumulativeRewards map.
   * The function also detects the first price epoch in the next reward epoch and triggers
   * the calculation of the cumulative claims for the next reward epoch.
   * After the end of the reward epoch and the end of the first price epoch in the next reward epoch
   * the cumulative claims for the reward epoch are stored in the rewardEpochCumulativeRewards map.
   * 
   * The function must be called for sequential price epochs.
   * @param priceEpoch 
   * @param calculationResults 
   */
  async calculateClaimsForPriceEpoch(priceEpoch: number, calculationResults: MedianCalculationResult[]) {
    if (priceEpoch !== this.currentUnprocessedPriceEpoch) {
      throw new Error("Price epoch is not the current unprocessed price epoch");
    }
    let epochCalculator = new RewardCalculatorForPriceEpoch(priceEpoch, this.votingRewardManager, this.votingManager);
    await epochCalculator.initialize();

    let claims = epochCalculator.claimsForSlots(calculationResults, this.iqrShare, this.pctShare);
    // regular price epoch in the current reward epoch
    if (priceEpoch < this.firstPriceEpochInNextRewardEpoch) {
      if (priceEpoch === this.initialPriceEpoch) {
        this.priceEpochClaims.set(priceEpoch, claims);
        this.rewardEpochCumulativeRewards.set(this.currentRewardEpoch, claims);
      } else {
        let previousClaims = this.priceEpochClaims.get(priceEpoch - 1);
        if (previousClaims === undefined) {
          throw new Error("Previous claims are undefined");
        }
        let cumulativeClaims = epochCalculator.mergeClaims(previousClaims, claims);
        this.priceEpochClaims.set(priceEpoch, claims);
        this.rewardEpochCumulativeRewards.set(this.currentRewardEpoch, cumulativeClaims);
      }
    } else {
      // first price epoch in the next reward epoch
      let previousClaims = this.priceEpochClaims.get(priceEpoch - 1);
      if (previousClaims === undefined) {
        throw new Error("Previous claims are undefined");
      }
      let cumulativeClaims = epochCalculator.mergeClaims(previousClaims, claims);
      this.priceEpochClaims.set(priceEpoch, claims);
      // last (claiming) cummulative claim records
      this.rewardEpochCumulativeRewards.set(this.currentRewardEpoch, cumulativeClaims);
      this.currentRewardEpoch++;
      // initialize empty cummulative claims for the new reward epoch
      this.rewardEpochCumulativeRewards.set(this.currentRewardEpoch, []);
    }
  }

  /**
   * Calculates the merkle tree for the given price epoch.
   * @param priceEpoch 
   * @returns 
   */
  merkleTreeForPriceEpoch(priceEpoch: number) {
    if (priceEpoch < this.initialPriceEpoch) {
      throw new Error("Price epoch is before the initial price epoch");
    }
    if (priceEpoch >= this.currentUnprocessedPriceEpoch) {
      throw new Error("Price epoch is after the current unprocessed price epoch");
    }
    let rewardEpoch = Math.floor((priceEpoch - this.firstRewardedPriceEpoch) / this.rewardEpochDurationInEpochs);
    let claims = this.rewardEpochCumulativeRewards.get(rewardEpoch);
    if (claims === undefined) {
      throw new Error("Claims are undefined");
    }
    let rewardClaimHashes = claims.map((value) => hashClaimReward(value));
    return new MerkleTree(rewardClaimHashes);
  }

}