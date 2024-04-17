import { Logger } from "@nestjs/common";
import ccxt, { Exchange, Ticker } from "ccxt";
import { readFileSync } from "fs";
import { networks } from "../../../../libs/ftso-core/src/configs/networks";
import { retry } from "../../../../libs/ftso-core/src/utils/retry";
import { FeedId, FeedValueData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { FeedCategory } from "../../../../libs/ftso-core/src/voting-types";
import https from 'https';
import { writeFileSync } from 'fs';

const CONFIG_PREFIX = "apps/example_provider/src/config/";
const RETRY_BACKOFF_MS = 10_000;

interface FeedConfig {
    feed: FeedId;
    sources: {
        exchange: string;
        symbol: string;
    }[];
}

interface PriceInfo {
    price: number;
    time: number;
    exchange: string;
}

const usdtToUsdFeedId: FeedId = { category: FeedCategory.Crypto.valueOf(), name: "USDT/USD" };

export class CcxtFeed implements BaseDataFeed {
    private readonly logger = new Logger(CcxtFeed.name);
    protected initialized = false;
    private config: FeedConfig[];

    private readonly exchangeByName: Map<string, Exchange> = new Map();

    /** Symbol -> exchange -> price */
    private readonly prices: Map<string, Map<string, PriceInfo>> = new Map();

    async start() {
        this.config = this.loadConfig();
        const exchangeToSymbols = new Map<string, Set<string>>();

        for (const feed of this.config) {
            for (const source of feed.sources) {
                const symbols = exchangeToSymbols.get(source.exchange) || new Set();
                symbols.add(source.symbol);
                exchangeToSymbols.set(source.exchange, symbols);
            }
        }

        this.logger.log(`Connecting to exchanges: ${JSON.stringify(Array.from(exchangeToSymbols.keys()))}`);
        const loadExchanges = [];
        for (const exchangeName of exchangeToSymbols.keys()) {
            try {
                const exchange: Exchange = new ccxt.pro[exchangeName]({ newUpdates: true });
                this.exchangeByName.set(exchangeName, exchange);
                loadExchanges.push([exchangeName, retry(async () => exchange.loadMarkets(), 2, RETRY_BACKOFF_MS, this.logger)]);
            } catch (e) {
                this.logger.warn(`Failed to initialize exchange ${exchangeName}, ignoring: ${e}`);
                exchangeToSymbols.delete(exchangeName);
            }
        }

        for (const [exchangeName, loadExchange] of loadExchanges) {
            try {
                await loadExchange;
                this.logger.log(`Exchange ${exchangeName} initialized`);
            } catch (e) {
                this.logger.warn(`Failed to load markets for ${exchangeName}, ignoring: ${e}`);
                exchangeToSymbols.delete(exchangeName);
            }
        }
        this.initialized = true;

        this.logger.log(`Initialization done, watching trades...`);
        void this.watchTrades(exchangeToSymbols);
    }

    async getValues(feeds: FeedId[]): Promise<FeedValueData[]> {
        const promises = feeds.map(feed => this.getValue(feed));
        // Here we add the test feed for XAU/USD directly to the array of promises
        // promises.push(this.getValue({ category: 2, name: "XAU/USD" }));
        return Promise.all(promises);
    }

    async getValue(feed: FeedId): Promise<FeedValueData> {
        let price;

        if (feed.name === "XAU/USD") {
            price = 0.69;  // Set the test price value for XAU/USD
        } else if (feed.name === "AUD/USD") {
            price = 0.75;  // Example test value for AUD/USD
        } else if (feed.name === "JPY/USD") {
            price = 0.0091;  // Example test value for JPY/USD
        } else if (feed.name === "XAG/USD") {
            price = 0.85;  // Example test value for XAG/USD
        } else if (feed.name === "XPT/USD") {
            price = 1.10;  // Example test value for XPT/USD
        } else {
            price = await this.getFeedPrice(feed);  // Fetch the actual price for other feeds
        }

        return {
            feed: feed,
            value: price,
        };
    }


    private async watchTrades(exchangeToSymbols: Map<string, Set<string>>) {
        for (const [exchangeName, symbols] of exchangeToSymbols) {
            const exchange = this.exchangeByName.get(exchangeName);
            if (exchange === undefined) continue;

            const symbolArray = Array.from(symbols);
            const marketIds = symbolArray.map(symbol => exchange.markets[symbol].id);
            void this.watch(exchange, marketIds, exchangeName);
        }
    }

    private async watch(exchange: Exchange, marketIds: string[], exchangeName: string) {
        this.logger.log(`Watching trades for ${marketIds} on exchange ${exchangeName}`);

        // eslint-disable-next-line no-constant-condition
        while (true) {
            try {
                const trades = await retry(async () => exchange.watchTradesForSymbols(marketIds, null, 100), RETRY_BACKOFF_MS);
                trades.forEach(trade => {
                    const prices = this.prices.get(trade.symbol) || new Map<string, PriceInfo>();
                    prices.set(exchangeName, { price: trade.price, time: trade.timestamp, exchange: exchangeName });
                    this.prices.set(trade.symbol, prices);
                });
            } catch (e) {
                this.logger.error(`Failed to watch trades for ${exchangeName}: ${e}`);
                return;
            }
        }
    }

    private async getFeedPrice(feedId: FeedId): Promise<number> {
        const config = this.config.find(config => feedsEqual(config.feed, feedId));
        if (!config) {
            this.logger.warn(`No config found for ${JSON.stringify(feedId)}`);
            return undefined;
        }

        const prices: number[] = [];

        let usdtToUsd = undefined;

        for (const source of config.sources) {
            const info = this.prices.get(source.symbol)?.get(source.exchange);
            if (info === undefined) continue;

            if (source.symbol.endsWith("USDT")) {
                if (usdtToUsd === undefined) usdtToUsd = await this.getFeedPrice(usdtToUsdFeedId);
                prices.push(info.price * usdtToUsd);
            } else {
                prices.push(info.price);
            }
        }

        if (prices.length === 0) {
            this.logger.warn(`No prices found for ${JSON.stringify(feedId)}`);
            return this.getFallbackPrice(usdtToUsdFeedId);
        }

        const result = prices.reduce((a, b) => a + b, 0) / prices.length;
        return result;
    }

    private async getFallbackPrice(feedId: FeedId): Promise<number> {
        const config = this.config.find(config => feedsEqual(config.feed, feedId));
        if (!config) {
            this.logger.warn(`No config found for ${JSON.stringify(feedId)}`);
            return undefined;
        }

        let usdtToUsd = undefined;

        for (const source of config.sources) {
            const exchange = this.exchangeByName.get(source.exchange);
            if (exchange === undefined) continue;
            const symbol = source.symbol;
            let ticker: Ticker;
            try {
                ticker = await retry(async () => await exchange.fetchTicker(symbol), RETRY_BACKOFF_MS);
                let price;
                if (source.symbol.endsWith("USDT")) {
                    if (usdtToUsd === undefined) usdtToUsd = await this.getFeedPrice(usdtToUsd);
                    price = ticker.last * usdtToUsd;
                } else {
                    price = ticker.last;
                }
                const priceForSymbol = this.prices.get(source.symbol) || new Map<string, PriceInfo>();
                priceForSymbol.set(source.exchange, { price: price, time: 0, exchange: source.exchange });
                this.prices.set(source.symbol, priceForSymbol);
                return price;
            } catch (e) {
                this.logger.error(`Failed to fetch ticker for ${symbol} on ${source.exchange}: ${e}`);
            }
        }

        this.logger.error(`No fallback price found for ${JSON.stringify(feedId)}`);
        return undefined;
    }

    private loadConfig() {
        const network = process.env.NETWORK as networks;
        let configPath: string;
        switch (network) {
            case "local-test":
                configPath = CONFIG_PREFIX + "coston.json";
                break;
            case "coston2":
                configPath = CONFIG_PREFIX + "coston.json";
                break;
            default:
                // TODO: Add support for from-env?
                configPath = CONFIG_PREFIX + "coston.json";
        }

        try {
            const jsonString = readFileSync(configPath, "utf-8");
            const config: FeedConfig[] = JSON.parse(jsonString);

            if (config.find(feed => feedsEqual(feed.feed, usdtToUsdFeedId)) === undefined) {
                throw new Error("Must provide USDT feed sources, as it is used for USD conversion.");
            }

            this.logger.log(`Supported feeds: ${JSON.stringify(config.map(f => f.feed))}`);

            return config;
        } catch (err) {
            this.logger.error("Error parsing JSON config:", err);
            throw err;
        }
    }
}

function feedsEqual(a: FeedId, b: FeedId): boolean {
    return a.category === b.category && a.name === b.name;
}
