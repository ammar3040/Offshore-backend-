/**
 * Admin settings for pricing and incentives.
 * Reads from env vars with sensible defaults.
 * Can be extended to load from DB later.
 */

export interface AdminSettings {
  baseCurrency: string;
  pricing: {
    flatMarkup: number;
    percentageMarkup: number;
  };
  incentives: {
    flatCashback: number;
    airlineSpecific: Array<{
      airlines?: string[];
      airline?: string;
      incentive: number;
    }>;
  };
}

const defaults: AdminSettings = {
  baseCurrency: "GBP",
  pricing: { flatMarkup: 0, percentageMarkup: 0 },
  incentives: { flatCashback: 0, airlineSpecific: [] },
};

export async function getAdminSettings(): Promise<AdminSettings> {
  const baseCurrency = process.env.ADMIN_BASE_CURRENCY || defaults.baseCurrency;
  const flatMarkup = Number(process.env.ADMIN_FLAT_MARKUP) || defaults.pricing.flatMarkup;
  const percentageMarkup =
    Number(process.env.ADMIN_PERCENTAGE_MARKUP) ?? defaults.pricing.percentageMarkup;
  const flatCashback =
    Number(process.env.ADMIN_FLAT_CASHBACK) ?? defaults.incentives.flatCashback;

  // Airline-specific incentives could come from env (e.g. JSON) or DB - stub for now
  let airlineSpecific = defaults.incentives.airlineSpecific;
  try {
    const envVal = process.env.ADMIN_AIRLINE_INCENTIVES;
    if (envVal) airlineSpecific = JSON.parse(envVal);
  } catch {
    // ignore parse errors
  }

  return {
    baseCurrency,
    pricing: { flatMarkup, percentageMarkup },
    incentives: { flatCashback, airlineSpecific },
  };
}
