/**
 * Multi-supplier flight stitching: combine Riya + Travel Terminus segments
 * into optimized A→…→Z itineraries with a minimum connection gap.
 */

export type OptimizationKind = "cheaper_faster" | "faster" | "cheaper" | "balanced";

export const FIXED_OPTIMIZE_HUBS = [
  "DEL",
  "BOM",
  "HYD",
  "BLR",
  "MAA",
  "AMD",
  "CCU",
  "PNQ",
  "GOI",
  "COK",
  "DXB",
  "AUH",
  "SIN",
  "LHR",
  "LGW",
  "MAN",
  "AMS",
  "FRA",
  "DOH",
  "IST",
] as const;

/** ISO country for known hub IATAs — needed so Riya sector (D/I) is correct on segments. */
export const HUB_COUNTRY_BY_IATA: Record<string, string> = {
  DEL: "IN",
  BOM: "IN",
  HYD: "IN",
  BLR: "IN",
  MAA: "IN",
  AMD: "IN",
  CCU: "IN",
  PNQ: "IN",
  GOI: "IN",
  COK: "IN",
  DXB: "AE",
  AUH: "AE",
  SIN: "SG",
  LHR: "GB",
  LGW: "GB",
  MAN: "GB",
  EDI: "GB",
  GLA: "GB",
  AMS: "NL",
  FRA: "DE",
  DOH: "QA",
  IST: "TR",
  CDG: "FR",
  MUC: "DE",
};

export function hubCountryCode(iata: string, fallback = "IN"): string {
  return HUB_COUNTRY_BY_IATA[iata.toUpperCase()] ?? fallback;
}

const DEFAULT_MIN_CONNECTION_HOURS = 3;
const DEFAULT_MAX_HUBS = 6;
const DEFAULT_TOP_K_PER_SEGMENT = 5;
const DEFAULT_SHORTLIST = 8;

export function flightBestPrice(flight: any): number {
  const fares = Array.isArray(flight?.fares) ? flight.fares : [];
  const prices = fares
    .map((fare: any) => Number(fare?.price ?? fare?.totalFare))
    .filter((n: number) => Number.isFinite(n) && n > 0);
  return prices.length ? Math.min(...prices) : Number.POSITIVE_INFINITY;
}

export function flightDurationMinutes(flight: any): number {
  if (Number.isFinite(flight?._durationMinutes)) return Number(flight._durationMinutes);
  const legs = Array.isArray(flight?.legs) ? flight.legs : [];
  if (legs.length > 0) {
    const dep = new Date(legs[0]?.departureTime).getTime();
    const arr = new Date(legs[legs.length - 1]?.arrivalTime).getTime();
    if (Number.isFinite(dep) && Number.isFinite(arr) && arr >= dep) {
      return Math.round((arr - dep) / 60_000);
    }
  }
  return Number.POSITIVE_INFINITY;
}

export function computeBaseline(flights: any[]): { bestPrice: number; bestDurationMinutes: number } {
  let bestPrice = Number.POSITIVE_INFINITY;
  let bestDurationMinutes = Number.POSITIVE_INFINITY;
  for (const flight of flights) {
    bestPrice = Math.min(bestPrice, flightBestPrice(flight));
    bestDurationMinutes = Math.min(bestDurationMinutes, flightDurationMinutes(flight));
  }
  return { bestPrice, bestDurationMinutes };
}

/** Collect intermediate IATA codes from normal A→Z offers. */
export function extractDynamicHubs(flights: any[], origin: string, destination: string): string[] {
  const originU = origin.toUpperCase();
  const destU = destination.toUpperCase();
  const counts = new Map<string, number>();

  for (const flight of flights) {
    const legs = Array.isArray(flight?.legs) ? flight.legs : [];
    for (const leg of legs) {
      const via = leg?.via;
      if (typeof via === "string" && /^[A-Z]{3}$/i.test(via.trim())) {
        const code = via.trim().toUpperCase();
        if (code !== originU && code !== destU) {
          counts.set(code, (counts.get(code) ?? 0) + 2);
        }
      }
      const itinerary = Array.isArray(leg?.itinerary) ? leg.itinerary : [];
      for (const seg of itinerary) {
        for (const key of ["from", "to"] as const) {
          const raw = String(seg?.[key] ?? "").toUpperCase();
          const code = raw.match(/\b([A-Z]{3})\b/)?.[1];
          if (code && code !== originU && code !== destU) {
            counts.set(code, (counts.get(code) ?? 0) + 1);
          }
        }
      }
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code]) => code);
}

export function selectOptimizeHubs(options: {
  origin: string;
  destination: string;
  baselineFlights: any[];
  maxHubs?: number;
  fixedHubs?: readonly string[];
}): string[] {
  const originU = options.origin.toUpperCase();
  const destU = options.destination.toUpperCase();
  const maxHubs = options.maxHubs ?? DEFAULT_MAX_HUBS;
  const fixed = options.fixedHubs ?? FIXED_OPTIMIZE_HUBS;
  const dynamic = extractDynamicHubs(options.baselineFlights, originU, destU);

  const ranked: string[] = [];
  const seen = new Set<string>();
  const push = (code: string) => {
    const c = code.toUpperCase();
    if (!c || c === originU || c === destU || seen.has(c)) return;
    seen.add(c);
    ranked.push(c);
  };

  for (const h of dynamic) push(h);
  for (const h of fixed) push(h);

  return ranked.slice(0, maxHubs);
}

/** Extract IATA from "DEL", "Delhi [DEL]", etc. */
export function extractIataCode(raw: unknown): string {
  const s = String(raw ?? "").toUpperCase().trim();
  if (!s) return "";
  const bracket = s.match(/\[([A-Z]{3})\]/);
  if (bracket) return bracket[1];
  if (/^[A-Z]{3}$/.test(s)) return s;
  return s.match(/\b([A-Z]{3})\b/)?.[1] ?? "";
}

function legEndpoints(flight: any): { from: string; to: string; dep: number; arr: number } | null {
  const legs = Array.isArray(flight?.legs) ? flight.legs : [];
  if (!legs.length) return null;
  const first = legs[0];
  const last = legs[legs.length - 1];
  const from = extractIataCode(first?.from);
  const to = extractIataCode(last?.to);
  const dep = new Date(first?.departureTime).getTime();
  const arr = new Date(last?.arrivalTime).getTime();
  if (!from || !to || !Number.isFinite(dep) || !Number.isFinite(arr)) return null;
  return { from, to, dep, arr };
}

/** Prefer non-stop, then cheapest, then shortest — keep top K. */
export function pickSegmentCandidates(flights: any[], topK = DEFAULT_TOP_K_PER_SEGMENT): any[] {
  const scored = flights
    .map((flight) => {
      const ends = legEndpoints(flight);
      if (!ends) return null;
      const stops = Number(flight?.stops ?? ends.from === ends.to ? 0 : flight?.legs?.[0]?.stops ?? 0);
      return {
        flight,
        ends,
        stops: Number.isFinite(stops) ? stops : 99,
        price: flightBestPrice(flight),
        duration: flightDurationMinutes(flight),
      };
    })
    .filter(Boolean) as Array<{
    flight: any;
    ends: { from: string; to: string; dep: number; arr: number };
    stops: number;
    price: number;
    duration: number;
  }>;

  scored.sort((a, b) => {
    if (a.stops !== b.stops) return a.stops - b.stops;
    if (a.price !== b.price) return a.price - b.price;
    return a.duration - b.duration;
  });

  return scored.slice(0, topK).map((s) => s.flight);
}

function formatGapHours(ms: number): string {
  const totalMins = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatDoorDuration(ms: number): string {
  return formatGapHours(ms);
}

function cheapestFare(flight: any): any | null {
  const fares = Array.isArray(flight?.fares) ? flight.fares : [];
  if (!fares.length) return null;
  return [...fares].sort(
    (a, b) => Number(a?.price ?? a?.totalFare ?? Infinity) - Number(b?.price ?? b?.totalFare ?? Infinity)
  )[0];
}

export function combineStitchedFlights(
  segments: any[],
  gapsMs: number[]
): any | null {
  if (segments.length < 2) return null;
  const legs: any[] = [];
  let totalPrice = 0;
  let totalMarkup = 0;
  let totalPct = 0;
  let totalSurcharge = 0;
  let totalBasic = 0;
  const suppliers = new Set<string>();

  for (const seg of segments) {
    const segLegs = Array.isArray(seg?.legs) ? seg.legs : [];
    if (!segLegs.length) return null;
    const supplier = seg.supplier === "travelterminus" ? "travelterminus" : "riya";
    suppliers.add(supplier);
    for (const leg of segLegs) {
      legs.push({ ...leg, supplier });
    }
    const fare = cheapestFare(seg);
    if (!fare) return null;
    totalPrice += Number(fare.price ?? fare.totalFare ?? 0);
    totalMarkup += Number(fare.markup ?? 0);
    totalPct += Number(fare.percentageMarkup ?? 0);
    totalSurcharge += Number(fare.cancellationSurcharge ?? 0);
    totalBasic += Number(fare.basicFare ?? 0);
  }

  const firstDep = legs[0]?.departureTime;
  const lastArr = legs[legs.length - 1]?.arrivalTime;
  const doorMs =
    new Date(lastArr).getTime() - new Date(firstDep).getTime();
  if (!Number.isFinite(doorMs) || doorMs <= 0) return null;

  const supplier =
    suppliers.size > 1 ? "mixed" : suppliers.has("travelterminus") ? "travelterminus" : "riya";

  const connectionGaps = gapsMs.map((ms, i) => {
    const airportRaw = String(legs[Math.min(i + 1, legs.length - 1)]?.from ?? "");
    return {
      airport: extractIataCode(airportRaw) || airportRaw,
      duration: formatGapHours(ms),
      hours: Math.round((ms / 3_600_000) * 10) / 10,
    };
  });

  const idParts = segments.map((s) => String(s.id ?? "x")).join("__");

  return {
    id: `opt-${idParts}`.slice(0, 180),
    optimized: true,
    supplier,
    legs,
    fares: [
      {
        type: "OPTIMIZED",
        name: "Optimized combination",
        indicator: "N",
        totalFare: Math.round(totalPrice),
        basicFare: Math.round(totalBasic),
        seats: "Available",
        cabin: cheapestFare(segments[0])?.cabin ?? "Economy",
        price: Math.round(totalPrice),
        markup: Math.round(totalMarkup),
        percentageMarkup: Math.round(totalPct),
        cancellationSurcharge: Math.round(totalSurcharge),
      },
    ],
    isMarineFare: false,
    airlineName: legs[0]?.airlineName,
    airlineCode: legs[0]?.airlineCode,
    stops: Math.max(0, legs.reduce((n, leg) => n + (Number(leg.stops) || 0), 0) + (legs.length - 1)),
    connectionGaps,
    duration: formatDoorDuration(doorMs),
    _durationMinutes: Math.round(doorMs / 60_000),
    cashback: null,
    appliedIncentive: null,
  };
}

export function stitchTwoHop(options: {
  origin: string;
  destination: string;
  hub: string;
  outbound: any[];
  inbound: any[];
  minConnectionHours?: number;
}): any[] {
  const minGapMs = (options.minConnectionHours ?? DEFAULT_MIN_CONNECTION_HOURS) * 3_600_000;
  const originU = options.origin.toUpperCase();
  const destU = options.destination.toUpperCase();
  const hubU = options.hub.toUpperCase();
  const out = pickSegmentCandidates(options.outbound);
  const inn = pickSegmentCandidates(options.inbound);
  const results: any[] = [];

  for (const a of out) {
    const aEnds = legEndpoints(a);
    if (!aEnds || aEnds.from !== originU || aEnds.to !== hubU) continue;
    for (const b of inn) {
      const bEnds = legEndpoints(b);
      if (!bEnds || bEnds.from !== hubU || bEnds.to !== destU) continue;
      const gap = bEnds.dep - aEnds.arr;
      if (gap < minGapMs) continue;
      const combined = combineStitchedFlights([a, b], [gap]);
      if (combined) results.push(combined);
    }
  }
  return results;
}

export function stitchThreeHop(options: {
  origin: string;
  destination: string;
  hub1: string;
  hub2: string;
  leg1: any[];
  leg2: any[];
  leg3: any[];
  minConnectionHours?: number;
}): any[] {
  const minGapMs = (options.minConnectionHours ?? DEFAULT_MIN_CONNECTION_HOURS) * 3_600_000;
  const originU = options.origin.toUpperCase();
  const destU = options.destination.toUpperCase();
  const h1 = options.hub1.toUpperCase();
  const h2 = options.hub2.toUpperCase();
  const aList = pickSegmentCandidates(options.leg1, 3);
  const bList = pickSegmentCandidates(options.leg2, 3);
  const cList = pickSegmentCandidates(options.leg3, 3);
  const results: any[] = [];

  for (const a of aList) {
    const aEnds = legEndpoints(a);
    if (!aEnds || aEnds.from !== originU || aEnds.to !== h1) continue;
    for (const b of bList) {
      const bEnds = legEndpoints(b);
      if (!bEnds || bEnds.from !== h1 || bEnds.to !== h2) continue;
      const gap1 = bEnds.dep - aEnds.arr;
      if (gap1 < minGapMs) continue;
      for (const c of cList) {
        const cEnds = legEndpoints(c);
        if (!cEnds || cEnds.from !== h2 || cEnds.to !== destU) continue;
        const gap2 = cEnds.dep - bEnds.arr;
        if (gap2 < minGapMs) continue;
        const combined = combineStitchedFlights([a, b, c], [gap1, gap2]);
        if (combined) results.push(combined);
      }
    }
  }
  return results;
}

function isDomesticPair(originCountry?: string, destCountry?: string): boolean {
  if (!originCountry || !destCountry) return true;
  return originCountry.toUpperCase() === destCountry.toUpperCase();
}

export function filterByDurationCap(
  candidates: any[],
  baselineDurationMinutes: number,
  originCountry?: string,
  destCountry?: string
): any[] {
  const domestic = isDomesticPair(originCountry, destCountry);
  const absoluteCap = domestic ? 36 * 60 : 72 * 60;
  const relativeCap =
    Number.isFinite(baselineDurationMinutes) && baselineDurationMinutes < Infinity
      ? baselineDurationMinutes * 1.6
      : absoluteCap;
  // Long-haul connections often need an overnight; allow generous headroom over the fastest A→Z.
  const connectionAllowance = domestic ? 8 * 60 : 24 * 60;
  const floorCap =
    Number.isFinite(baselineDurationMinutes) && baselineDurationMinutes < Infinity
      ? baselineDurationMinutes + connectionAllowance
      : absoluteCap;
  const cap = Math.min(absoluteCap, Math.max(relativeCap, floorCap));

  return candidates.filter((f) => {
    const d = flightDurationMinutes(f);
    return Number.isFinite(d) && d <= cap;
  });
}

function flightKey(flight: any): string {
  const legs = Array.isArray(flight?.legs) ? flight.legs : [];
  return legs
    .map(
      (l: any) =>
        `${l.from}-${l.to}-${l.departureTime}-${l.arrivalTime}-${l.supplier ?? ""}`
    )
    .join("|");
}

/**
 * Shortlist diversity buckets vs baseline.
 * Keeps options that beat baseline on at least one axis without collapsing the other too badly.
 * If none pass the strict bar, falls back to the best scored capped candidates (still useful connections).
 */
export function shortlistOptimized(
  candidates: any[],
  baseline: { bestPrice: number; bestDurationMinutes: number },
  limit = DEFAULT_SHORTLIST
): any[] {
  const basePrice = baseline.bestPrice;
  const baseDur = baseline.bestDurationMinutes;
  if (!candidates.length) return [];
  if (!Number.isFinite(basePrice) || !Number.isFinite(baseDur)) {
    // No usable A→Z baseline — still return a few cheapest/shortest stitches.
    return candidates
      .map((f) => ({
        f,
        p: flightBestPrice(f),
        d: flightDurationMinutes(f),
        score:
          (Number.isFinite(flightBestPrice(f)) ? flightBestPrice(f) : 1e9) / 1000 +
          (Number.isFinite(flightDurationMinutes(f)) ? flightDurationMinutes(f) : 1e9) / 60,
      }))
      .filter((s) => Number.isFinite(s.p) && Number.isFinite(s.d))
      .sort((a, b) => a.score - b.score)
      .slice(0, limit)
      .map((s) => ({
        ...s.f,
        optimizationKind: "balanced" as OptimizationKind,
        baselineDelta: { price: 0, durationMinutes: 0 },
      }));
  }

  const durSlack = Math.max(baseDur * 1.75, baseDur + 18 * 60);
  const priceSlack = basePrice * 1.35;

  const viable = candidates.filter((f) => {
    const p = flightBestPrice(f);
    const d = flightDurationMinutes(f);
    if (!Number.isFinite(p) || !Number.isFinite(d)) return false;
    const cheaper = p < basePrice * 0.995;
    const faster = d < baseDur * 0.995;
    const notMuchWorsePrice = p <= priceSlack;
    const notMuchWorseDur = d <= durSlack;
    if (cheaper && faster) return true;
    if (faster && notMuchWorsePrice) return true;
    if (cheaper && notMuchWorseDur) return true;
    // Near-parity options that improve normalized score
    if (notMuchWorsePrice && notMuchWorseDur && p / basePrice + d / baseDur < 1.85) return true;
    return false;
  });

  const pool = (viable.length > 0 ? viable : candidates).filter((f) => {
    const p = flightBestPrice(f);
    const d = flightDurationMinutes(f);
    return Number.isFinite(p) && Number.isFinite(d);
  });

  const scored = pool.map((f) => {
    const p = flightBestPrice(f);
    const d = flightDurationMinutes(f);
    const cheaper = p < basePrice;
    const faster = d < baseDur;
    let kind: OptimizationKind = "balanced";
    if (cheaper && faster) kind = "cheaper_faster";
    else if (faster) kind = "faster";
    else if (cheaper) kind = "cheaper";
    const normPrice = p / basePrice;
    const normDur = d / baseDur;
    return { f, p, d, kind, score: normPrice + normDur };
  });

  const pickBest = (
    pred: (s: (typeof scored)[0]) => boolean,
    compare: (a: (typeof scored)[0], b: (typeof scored)[0]) => number
  ) => {
    const matched = scored.filter(pred).sort(compare);
    return matched[0] ?? null;
  };

  const selected: typeof scored = [];
  const used = new Set<string>();
  const take = (item: (typeof scored)[0] | null) => {
    if (!item) return;
    const key = flightKey(item.f);
    if (used.has(key)) return;
    used.add(key);
    selected.push(item);
  };

  take(
    pickBest(
      (s) => s.kind === "cheaper_faster",
      (a, b) => a.score - b.score || a.p - b.p
    )
  );
  take(
    pickBest(
      (s) => s.kind === "faster" && s.p <= basePrice * 1.35,
      (a, b) => a.d - b.d || a.p - b.p
    )
  );
  take(
    pickBest(
      (s) => s.kind === "cheaper" && s.d <= durSlack,
      (a, b) => a.p - b.p || a.d - b.d
    )
  );
  take(pickBest(() => true, (a, b) => a.score - b.score));

  const rest = scored
    .filter((s) => !used.has(flightKey(s.f)))
    .sort((a, b) => a.score - b.score);
  for (const s of rest) {
    if (selected.length >= limit) break;
    take(s);
  }

  return selected.slice(0, limit).map((s) => ({
    ...s.f,
    optimizationKind: s.kind,
    baselineDelta: {
      price: Math.round(s.p - basePrice),
      durationMinutes: Math.round(s.d - baseDur),
    },
  }));
}

export const OPTIMIZE_DEFAULTS = {
  minConnectionHours: DEFAULT_MIN_CONNECTION_HOURS,
  maxHubs: DEFAULT_MAX_HUBS,
  topK: DEFAULT_TOP_K_PER_SEGMENT,
  shortlist: DEFAULT_SHORTLIST,
};
