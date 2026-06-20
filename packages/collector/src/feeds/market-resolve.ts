import {
  marketCacheKey,
  newMarketCache,
  spawnMarketCacheRefresh,
  type MarketCache,
} from "@pmt/shared";

export function spawnMarketResolve(gammaUrl: string, clobUrl: string): MarketCache {
  const cache = newMarketCache();
  spawnMarketCacheRefresh(cache, gammaUrl, clobUrl, 30);
  return cache;
}

export { marketCacheKey, type MarketCache };
