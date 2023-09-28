import BN from "bn.js";
import { TransactionReceipt } from "web3-core";
import { Bytes32 } from "./utils/sol-types";

export interface RewardClaim {
  /**
   * `true`if the claim is for the full amount claimable by the specified beneficiary. E.g: back claims, signer and finalization claims.
   * `false` if the claim is for voting rewards, where the amount is shared between the beneficiary voter and its delegators proportionally to their weights.
   */
  readonly isFixedClaim: boolean;
  readonly amount: BN; // 256-bit
  readonly currencyAddress: string;
  readonly beneficiary: string;
  readonly priceEpochId: number;
}
export interface RewardClaimWithProof {
  readonly merkleProof: readonly string[];
  readonly body: RewardClaim;
}

export interface Feed {
  offerSymbol: string; // 4 characters/bytes
  quoteSymbol: string; // 4 characters/bytes
}

export interface Offer extends Feed {
  amount: BN; // 256-bit
  currencyAddress: string;
  leadProviders: string[]; // list of trusted providers
  rewardBeltPPM: BN; // reward belt in PPM (parts per million) in relation to the median price of the trusted providers.
  elasticBandWidthPPM: BN; // elastic band width in PPM (parts per million) in relation to the median price.
  iqrSharePPM: BN; // Each offer defines IQR and PCT share in PPM (parts per million). The sum of all offers must be 1M.
  pctSharePPM: BN;
  remainderClaimer: string;
}

export interface RewardOffered extends Offer {
  priceEpochId?: number;
  transactionId?: string;
  flrValue: BN;
}

export interface FeedValue extends Feed {
  feedId: string;
  flrValue: BN;
}

export interface BareSignature {
  readonly v: number;
  readonly r: string;
  readonly s: string;
}

export interface RevealBitvoteData {
  readonly random: string;
  readonly merkleRoot: string;
  readonly bitVote: string;
  readonly prices: string; // 4-byte hex strings
}

export interface SignatureData {
  readonly epochId: number;
  readonly merkleRoot: string;
  readonly v: number;
  readonly r: string;
  readonly s: string;
}

export interface FinalizeData {
  readonly from: string;
  readonly epochId: number;
  readonly merkleRoot: string;
  readonly signatures: readonly BareSignature[];
}

export interface TxData {
  blockNumber: number;
  hash: string;
  input?: string;
  from: string;
  to?: string;
  value?: string;
  receipt?: TransactionReceipt;
}

export interface BlockData {
  number: number;
  timestamp: number;
  transactions: readonly TxData[];
}

export interface EpochData {
  readonly epochId: number;
  readonly merkleRoot: string;
  readonly random: Bytes32;
  readonly prices: number[];
  readonly pricesHex: string;
  readonly bitVote: string;
}

export interface EpochResult {
  readonly priceEpochId: number;
  readonly medianData: readonly MedianCalculationResult[];
  readonly random: Bytes32;
  readonly randomQuality: number;
  readonly priceMessage: string;
  readonly symbolMessage: string;
  readonly randomMessage: string;
  readonly fullPriceMessage: string;
  readonly rewardClaimMerkleRoot: string;
  readonly rewardClaimMerkleProof: string;
  readonly rewardClaims: readonly RewardClaim[];
  readonly fullMessage: string;
  readonly merkleRoot: string;
}

export interface MedianCalculationResult {
  readonly feed: Feed;
  readonly voters?: readonly string[];
  readonly prices?: readonly number[];
  readonly data: MedianCalculationSummary;
  readonly weights: readonly BN[];
}

export interface MedianCalculationSummary {
  readonly finalMedianPrice: number;
  readonly quartile1Price: number;
  readonly quartile3Price: number;
}

export interface VoterWithWeight {
  readonly voterAddress: string;
  weight: BN;
  readonly originalWeight: BN;
}

export interface VoterRewarding extends VoterWithWeight {
  readonly pct: boolean; // gets PCT reward
  readonly iqr: boolean; // gets IQR reward
  readonly eligible: boolean; // is eligible for reward
}

export interface RevealResult {
  readonly revealed: string[];
  readonly failedCommit: string[];
  readonly committedFailedReveal: string[];
  readonly revealedRandoms: Bytes32[];
}
