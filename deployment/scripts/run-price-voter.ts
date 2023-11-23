import { readFileSync } from "fs";
import { FTSOClient } from "../../src/protocol/FTSOClient";
import { Web3Provider } from "../../src/providers/Web3Provider";
import { FTSOParameters, loadFTSOParameters } from "../config/FTSOParameters";
import { OUTPUT_FILE, getPriceFeeds, loadAccounts } from "../tasks/common";
import { ContractAddresses } from "../../src/protocol/utils/ContractAddresses";
import { IPriceFeed } from "../../src/protocol/IPriceFeed";
import { Feed } from "../../src/protocol/voting-types";
import { getLogger, setGlobalLogFile } from "../../src/utils/logger";
import { getWeb3 } from "../../src/utils/web3";
import { RandomPriceFeed, createPriceFeedConfigs } from "../../test-utils/utils/RandomPriceFeed";
import { PriceVoter } from "../../src/PriceVoter";
import { EpochSettings } from "../../src/protocol/utils/EpochSettings";
import { BlockIndexer } from "../../src/BlockIndexer";

async function main() {
  const myId = +process.argv[2];
  if (!myId) throw Error("Must provide a price voter id.");
  if (myId <= 0) throw Error("Price voter id must be greater than 0.");
  const useRandomFeed = process.argv[3] == "random";

  setGlobalLogFile(`price-voter-${myId}`);

  const parameters = loadFTSOParameters();
  const web3 = getWeb3(parameters.rpcUrl.toString());

  const contractAddresses = loadContracts();
  getLogger("price-voter").info(`Initializing price voter ${myId}, connecting to ${parameters.rpcUrl}`);

  let privateKey: string;
  if (process.env.VOTER_PRIVATE_KEY != undefined) {
    privateKey = process.env.VOTER_PRIVATE_KEY;
  } else {
    const accounts = loadAccounts(web3);
    privateKey = accounts[myId].privateKey;
  }

  const provider = await Web3Provider.create(contractAddresses, web3, parameters, privateKey);
  const epochSettings = EpochSettings.fromProvider(provider);
  const feeds = await getFeeds(useRandomFeed, parameters);
  const indexer = new BlockIndexer(provider);
  indexer.run();

  const client = new FTSOClient(provider, indexer, epochSettings, feeds, getLogger(FTSOClient.name));
  const priceVoter = new PriceVoter(client, indexer, epochSettings);
  await priceVoter.run();
}

async function getFeeds(useRandomFeed: boolean, parameters: FTSOParameters) {
  let feeds: IPriceFeed[];
  if (useRandomFeed) {
    // Uses a fake randomised price feed.
    const symbols = parameters.feeds.map(x => x.symbol);
    feeds = createPriceFeedConfigs(symbols).map(config => new RandomPriceFeed(config));
  } else {
    // Uses a real price feed, with additional random noise.
    feeds = randomizeFeeds(await getPriceFeeds(parameters.feeds));
  }
  return feeds;
}

function loadContracts(): ContractAddresses {
  const parsed = JSON.parse(readFileSync(OUTPUT_FILE).toString());
  if (Object.entries(parsed).length == 0) throw Error(`No contract addresses found in ${OUTPUT_FILE}`);
  return parsed;
}

function randomizeFeeds(feeds: IPriceFeed[]): IPriceFeed[] {
  return feeds.map(feed => {
    return new (class implements IPriceFeed {
      getPriceForEpoch(priceEpochId: number): number {
        const originalPrice = feed.getPriceForEpoch(priceEpochId);
        return addNoise(originalPrice);
      }
      getFeedInfo(): Feed {
        return feed.getFeedInfo();
      }
    })();
  });
}

function addNoise(num: number): number {
  const noise = num * 0.001 * Math.random();
  const sign = Math.random() < 0.5 ? -1 : 1;
  return num + noise * sign;
}

main().catch(e => {
  console.error("Price voter error, exiting", e);
  getLogger("price-voter").error(e);
  process.exit(1);
});
