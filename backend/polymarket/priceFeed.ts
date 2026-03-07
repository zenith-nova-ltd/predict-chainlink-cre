import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

const aggregatorV3InterfaceABI = [
  'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
  'function decimals() view returns (uint8)',
];

const RPC_URL = process.env.ETHEREUM_RPC_URL || process.env.RPC_URL || '';
const provider = RPC_URL ? new ethers.JsonRpcProvider(RPC_URL) : null;

const FEED_ADDRESSES: Record<string, string> = {
  BTC: process.env.CHAINLINK_BTC_USD_FEED || '',
  ETH: process.env.CHAINLINK_ETH_USD_FEED || '',
  SOL: process.env.CHAINLINK_SOL_USD_FEED || '',
};

interface AggregatorV3Interface {
  decimals(): Promise<bigint | number>;
  latestRoundData(): Promise<[bigint, bigint, bigint, bigint, bigint]>;
}

export async function getChainlinkUsdPrice(assetSymbol: string): Promise<number | null> {
  if (!provider) {
    return null;
  }

  const symbol = assetSymbol.toUpperCase();
  const feedAddress = FEED_ADDRESSES[symbol];
  if (!feedAddress) {
    return null;
  }

  try {
    const feed = new ethers.Contract(
      feedAddress,
      aggregatorV3InterfaceABI,
      provider
    ) as unknown as AggregatorV3Interface;

    const decimalsBig = await feed.decimals();
    const decimals = Number(decimalsBig);

    const latestRoundData = await feed.latestRoundData();
    const answer = latestRoundData[1];

    if (answer <= 0n) {
      return null;
    }

    const price = Number(answer) / 10 ** decimals;
    return Math.round(price * 10000) / 10000;
  } catch {
    return null;
  }
}