import {
  marketCacheKey,
  newMarketCache,
  spawnMarketCacheRefresh,
  type Asset,
  type MarketCache,
  type TimeFrame,
} from "@pmt/shared";

export function spawnMarketResolve(
  gammaUrl: string,
  clobUrl: string,
  assets?: Asset[],
  timeframes?: TimeFrame[],
): MarketCache {
  const cache = newMarketCache();
  spawnMarketCacheRefresh(cache, gammaUrl, clobUrl, 30, assets, timeframes);
  return cache;
}

export { marketCacheKey, type MarketCache };
