import { createHash } from "crypto";

interface CachedFlightSearch {
  flights: any[];
  createdAt: number;
}

const CACHE_TTL_MS = 3 * 60_000;
const CACHE_MAX_ENTRIES = 40;
const cache = new Map<string, CachedFlightSearch>();

export function buildFlightSearchCacheKey(parts: Record<string, unknown>): string {
  const normalized = JSON.stringify(parts, Object.keys(parts).sort());
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

export function getCachedFlightSearch(key: string): any[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.createdAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // LRU touch
  cache.delete(key);
  cache.set(key, hit);
  return hit.flights;
}

export function setCachedFlightSearch(key: string, flights: any[]): void {
  cache.set(key, { flights, createdAt: Date.now() });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}
