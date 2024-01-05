import { readFileSync } from "fs";
import { toBN } from "../../../../libs/ftso-core/src/utils/voting-utils";
import { Feed } from "../../../../libs/ftso-core/src/voting-types";
import dotenv from "dotenv";
import BN from "bn.js";

dotenv.config();

export interface FeedConfig {
  readonly providerImpl: string;
  readonly symbol: Feed;
}

export interface FTSOParameters {
  governancePrivateKey: string;
  rpcUrl: URL;
  gasLimit: BN;
  gasPriceMultiplier: number;
  feeds: FeedConfig[];
}

function loadParameters(filename: string): FTSOParameters {
  const jsonText = readFileSync(filename).toString();
  const parameters = JSON.parse(jsonText, (key, value) => {
    if (key === "rpcUrl") return new URL(value);
    if (key === "gasLimit") return toBN(value);
    return value;
  });
  return parameters;
}

export function loadFTSOParameters() {
  const chain = process.env.CHAIN_CONFIG;
  if (chain) {
    const parameters = loadParameters(`config/config-${chain}.json`);
    if (process.env.DEPLOYER_PRIVATE_KEY) {
      parameters.governancePrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
    }
    return parameters;
  } else {
    throw Error("Chain config must be set in env CHAIN_CONFIG");
  }
}