/**
 * Currency conversion utilities.
 * Uses Frankfurter API for live rates (free, no API key).
 */

export type CurrencyCode =
  | "GBP"
  | "USD"
  | "EUR"
  | "INR"
  | "AUD"
  | "CAD"
  | "CHF"
  | "CNY"
  | "JPY"
  | "SGD"
  | "AED"
  | string;

export interface ExchangeRates {
  base: string;
  rates: Record<string, number>;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let cachedRates: ExchangeRates | null = null;
let cachedAt = 0;

export async function fetchRates(): Promise<ExchangeRates> {
  if (cachedRates && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedRates;
  }
  const base = "GBP";
  const res = await fetch(
    `https://api.frankfurter.app/latest?from=${base}&to=USD,EUR,INR,AED,AUD,CAD,CHF,CNY,JPY,SGD`
  );
  if (!res.ok) {
    throw new Error(`Currency API error: ${res.status}`);
  }
  const data = (await res.json()) as { base: string; rates: Record<string, number> };
  cachedRates = { base: data.base, rates: { [base]: 1, ...data.rates } };
  cachedAt = Date.now();
  return cachedRates;
}

/**
 * Convert amount from one currency to another using rates.
 * Rates are assumed to be relative to a base (e.g. GBP).
 */
export function convert(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: ExchangeRates
): number {
  if (from === to) return amount;
  const { base, rates: r } = rates;
  const fromRate = from === base ? 1 : (r[from] ?? 0);
  const toRate = to === base ? 1 : (r[to] ?? 0);
  if (fromRate <= 0 || toRate <= 0) return amount; // fallback: no conversion
  return (amount / fromRate) * toRate;
}
