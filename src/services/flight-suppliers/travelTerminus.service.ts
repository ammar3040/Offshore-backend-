/**
 * Travel Terminus flight search (stage/prod).
 * Auth: POST /api/auth/generate-token → access-token header (24h).
 * Search: GET /api/flights/search-stream (SSE) → normalize to Riya-compatible flight objects.
 *
 * Docs: https://supplier-api.travelterminus.com
 */

export type FlightSupplierId = "riya" | "travelterminus";

export interface TravelTerminusSearchInput {
  origin: string;
  destination: string;
  departureDate: string; // YYYY-MM-DD
  returnDate?: string;
  adults: number;
  children: number;
  infants: number;
  cabinClass: string;
  currency: string;
  endUserIP?: string;
  endUserBrowserAgent?: string;
  tripType: "one-way" | "round-trip";
  /** Abort / max wait for SSE stream (ms). */
  timeoutMs?: number;
}

interface TravelTerminusConfig {
  baseUrl: string;
  apiKey: string;
  secretKey: string;
  version: string;
}

function readConfig(): TravelTerminusConfig {
  return {
    baseUrl: (process.env.TRAVELTERMINUS_BASE_URL ?? "https://api-stage.travelterminus.com").replace(
      /\/+$/,
      ""
    ),
    apiKey: (process.env.TRAVELTERMINUS_API_KEY ?? "").trim(),
    secretKey: (process.env.TRAVELTERMINUS_SECRET_KEY ?? "").trim(),
    version: process.env.TRAVELTERMINUS_API_VERSION ?? "1",
  };
}

export function isTravelTerminusConfigured(): boolean {
  const c = readConfig();
  return Boolean(c.apiKey && c.secretKey);
}

export function travelTerminusStatus() {
  const c = readConfig();
  return {
    provider: "travelterminus" as const,
    configured: Boolean(c.apiKey && c.secretKey),
    baseUrl: c.baseUrl,
  };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(config: TravelTerminusConfig): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

  const response = await fetch(`${config.baseUrl}/api/auth/generate-token`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
      version: config.version,
      language: "en",
    },
    body: JSON.stringify({ apiKey: config.apiKey, secretKey: config.secretKey }),
    signal: AbortSignal.timeout(20_000),
  });

  const payload = (await response.json().catch(() => null)) as {
    status?: boolean;
    data?: { accessToken?: string; expiresIn?: number };
    message?: string;
  } | null;

  if (!response.ok || !payload?.data?.accessToken) {
    throw new Error(
      `TravelTerminus auth failed (HTTP ${response.status}): ${payload?.message ?? "no token"}`
    );
  }

  const lifetimeMs = (payload.data.expiresIn ?? 86_400) * 1000;
  cachedToken = { value: payload.data.accessToken, expiresAt: now + lifetimeMs };
  return cachedToken.value;
}

function mapCabin(cabinClass: string): string {
  const key = cabinClass.toLowerCase().replace(/-/g, "_");
  if (key.includes("premium")) return "premium_economy";
  if (key.includes("business")) return "business";
  if (key.includes("first")) return "first";
  return "economy";
}

function parseDurationToHm(value: string | undefined): string {
  if (!value) return "Unknown";
  const trimmed = value.trim();
  if (/^\d+h(\s*\d+m)?$/i.test(trimmed)) return trimmed.replace(/\s+/g, " ");
  const match = trimmed.match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/i);
  if (!match) return trimmed;
  const h = Number(match[1] ?? 0);
  const m = Number(match[2] ?? 0);
  if (!h && !m) return trimmed;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "3:55 PM" + "2026-06-12" → ISO-ish local string for existing UI parsers. */
function toIsoLocal(date: string | undefined, time: string | undefined): string {
  if (!date) return "";
  if (!time) return `${date}T00:00:00`;

  const tm = time.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!tm) {
    if (/^\d{2}:\d{2}/.test(time)) return `${date}T${time.slice(0, 8)}`;
    return `${date}T00:00:00`;
  }

  let hour = Number(tm[1]);
  const minute = Number(tm[2]);
  const meridiem = (tm[3] ?? "").toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function placeLabel(place: any): { code: string; airport: string; city: string } {
  const code = String(place?.code ?? place?.cityCode ?? "").toUpperCase();
  const city = String(place?.city ?? place?.cityCode ?? code);
  const name = String(place?.name ?? "");
  const airport = name ? `${city} [${code}]` : `${code}`;
  return { code, airport, city };
}

function baggageText(bags: any[] | undefined): string {
  if (!Array.isArray(bags) || bags.length === 0) return "No info";
  const adult = bags.find((b) => String(b?.paxType) === "0") ?? bags[0];
  const size = adult?.size || adult?.rule || "";
  return size ? String(size) : "No info";
}

function normalizeSegment(seg: any) {
  const dep = Array.isArray(seg?.departure) ? seg.departure[0] : seg?.departure;
  const arr = Array.isArray(seg?.arrival) ? seg.arrival[0] : seg?.arrival;
  const from = placeLabel(dep);
  const to = placeLabel(arr);

  return {
    airlineName: String(seg?.airlineName ?? ""),
    airlineCode: String(seg?.airlineCode ?? ""),
    flightNumber: String(seg?.flightNumber ?? ""),
    from: from.code,
    fromAirport: from.airport,
    fromTerminal: dep?.terminal != null ? String(dep.terminal) : undefined,
    to: to.code,
    toAirport: to.airport,
    toTerminal: arr?.terminal != null ? String(arr.terminal) : undefined,
    departureTime: toIsoLocal(dep?.date, dep?.time),
    arrivalTime: toIsoLocal(arr?.date, arr?.time),
    duration: parseDurationToHm(seg?.segmentDuration),
    cabin: String(seg?.cabinClass ?? "Economy"),
    baggage: baggageText(seg?.checkInBaggages),
    cabinBaggage: baggageText(seg?.cabinBaggages),
    layover: null as null | { location: string; duration: string },
  };
}

function attachLayovers(itinerary: ReturnType<typeof normalizeSegment>[]) {
  for (let i = 0; i < itinerary.length - 1; i++) {
    const cur = itinerary[i]!;
    const next = itinerary[i + 1]!;
    const arr = new Date(cur.arrivalTime).getTime();
    const dep = new Date(next.departureTime).getTime();
    if (Number.isFinite(arr) && Number.isFinite(dep) && dep > arr) {
      const diffMs = dep - arr;
      const h = Math.floor(diffMs / 3_600_000);
      const m = Math.floor((diffMs % 3_600_000) / 60_000);
      cur.layover = { location: cur.to, duration: `${h}h ${m}m` };
    }
  }
  return itinerary;
}

function durationMinutesFromHm(value: string | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const match = String(value).match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/i);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

function normalizeRoute(route: any, index: number, origin: string, destination: string) {
  const segmentGroups: any[][] = Array.isArray(route?.flightSegments) ? route.flightSegments : [];
  const legs = segmentGroups
    .map((group) => {
      const segs = Array.isArray(group) ? group : [];
      if (segs.length === 0) return null;
      const itinerary = attachLayovers(segs.map(normalizeSegment));
      const first = itinerary[0]!;
      const last = itinerary[itinerary.length - 1]!;
      const totalDuration = parseDurationToHm(
        Array.isArray(route?.totalDuration) ? route.totalDuration[0] : route?.totalDuration
      );
      return {
        airlineName: first.airlineName,
        airlineCode: first.airlineCode,
        from: first.from,
        to: last.to,
        departureTime: first.departureTime,
        arrivalTime: last.arrivalTime,
        duration: totalDuration,
        stops: Math.max(0, itinerary.length - 1),
        via: itinerary.length > 1 ? itinerary[0]!.to : null,
        itinerary,
      };
    })
    .filter(Boolean);

  if (legs.length === 0) return null;

  const fare = Array.isArray(route?.fare) ? route.fare[0] : route?.fare;
  const totalFare = Number(fare?.totalFare ?? fare?.walletPoints ?? 0);
  const basicFare = Number(fare?.totalBaseFare ?? fare?.perAdtBaseFare ?? 0);
  const currency = String(fare?.branchCurrency ?? "USD");
  const flightObject = route?.flightObject ?? {};
  const solutionId = Array.isArray(flightObject?.solutionId)
    ? flightObject.solutionId[0]
    : flightObject?.solutionId;
  const routeId = String(flightObject?.routeId ?? solutionId ?? `tt-${origin}-${destination}-${index}`);

  return {
    id: `tt-${routeId}-${index}`,
    supplier: "travelterminus" as FlightSupplierId,
    legs,
    fares: [
      {
        type: String(fare?.fareType ?? "PUBLIC"),
        name: String(fare?.fareType ?? "Public"),
        indicator: "N",
        totalFare,
        basicFare,
        seats: 9,
        cabin: String(legs[0]?.itinerary?.[0]?.cabin ?? "Economy"),
      },
    ],
    isMarineFare: false,
    fareBreakdown: {
      total: totalFare,
      base: basicFare,
      tax: Number(fare?.totalTax ?? 0),
      serviceFee: 0,
      gst: 0,
    },
    airlineName: legs[0]?.airlineName,
    airlineCode: legs[0]?.airlineCode,
    stops: Math.max(...legs.map((l: any) => l.stops ?? 0)),
    originalCurrency: currency,
    /** Opaque TT tokens for Phase-2 book — kept out of UI. */
    supplierMeta: {
      searchReqId: undefined as string | undefined,
      hashReqKey: undefined as string | undefined,
      flightObject,
    },
    _durationMinutes: durationMinutesFromHm(
      Array.isArray(route?.totalDuration) ? route.totalDuration[0] : route?.totalDuration
    ),
  };
}

/** Consume SSE until search_completed / stop_loader or timeout; return last route list. */
async function consumeSearchStream(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ routes: any[]; searchReqId?: string; hashReqKey?: string; currency?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`TravelTerminus search HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let routes: any[] = [];
    let searchReqId: string | undefined;
    let hashReqKey: string | undefined;
    let currency: string | undefined;
    let done = false;

    const handleEvent = (rawData: string) => {
      let event: any;
      try {
        event = JSON.parse(rawData);
      } catch {
        return;
      }
      const type = event?.type;
      const data = event?.data;
      const searchResponse = data?.searchResponse;
      if (searchResponse?.route && Array.isArray(searchResponse.route)) {
        routes = searchResponse.route;
        searchReqId = searchResponse.searchReqId ?? searchReqId;
        hashReqKey = searchResponse.hashReqKey ?? hashReqKey;
        currency = searchResponse.meta?.currency ?? currency;
      }
      if (type === "search_completed" || type === "stop_loader" || type === "almost_complete") {
        if (searchResponse?.route) routes = searchResponse.route;
        done = type === "search_completed" || type === "stop_loader";
      }
    };

    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const dataLines = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim());
        if (dataLines.length) handleEvent(dataLines.join("\n"));
      }
    }

    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }

    return { routes, searchReqId, hashReqKey, currency };
  } finally {
    clearTimeout(timer);
  }
}

export async function searchTravelTerminusFlights(input: TravelTerminusSearchInput): Promise<any[]> {
  if (!isTravelTerminusConfigured()) return [];

  const config = readConfig();
  const token = await getAccessToken(config);

  const legs =
    input.tripType === "round-trip" && input.returnDate
      ? [
          {
            departureDate: input.departureDate,
            origin: input.origin.toUpperCase(),
            destination: input.destination.toUpperCase(),
          },
          {
            departureDate: input.returnDate,
            origin: input.destination.toUpperCase(),
            destination: input.origin.toUpperCase(),
          },
        ]
      : [
          {
            departureDate: input.departureDate,
            origin: input.origin.toUpperCase(),
            destination: input.destination.toUpperCase(),
          },
        ];

  const paxes = [
    { type: "ADT", quantity: Math.max(1, input.adults || 1) },
    { type: "CHD", quantity: Math.max(0, input.children || 0) },
    { type: "INF", quantity: Math.max(0, input.infants || 0) },
  ];

  const travelPreferences = {
    cabinClass: mapCabin(input.cabinClass),
    airTripType: input.tripType === "round-trip" ? "roundtrip" : "oneway",
  };

  const params = new URLSearchParams();
  params.set("searchAirLegs", JSON.stringify(legs));
  params.set("paxes", JSON.stringify(paxes));
  params.set("endUserIP", input.endUserIP || "127.0.0.1");
  params.set(
    "endUserBrowserAgent",
    input.endUserBrowserAgent || "Mozilla/5.0 (compatible; OffshoreCRM/1.0)"
  );
  params.set("travelPreferences", JSON.stringify(travelPreferences));

  const url = `${config.baseUrl}/api/flights/search-stream?${params.toString()}`;
  const { routes, searchReqId, hashReqKey, currency } = await consumeSearchStream(
    url,
    {
      accept: "application/json",
      version: config.version,
      language: "en",
      "Currency-Preference": (input.currency || "USD").toUpperCase(),
      "access-token": token,
    },
    input.timeoutMs ?? 55_000
  );

  return routes
    .map((route, index) => {
      const normalized = normalizeRoute(route, index, input.origin, input.destination);
      if (!normalized) return null;
      if (normalized.supplierMeta) {
        normalized.supplierMeta.searchReqId = searchReqId;
        normalized.supplierMeta.hashReqKey = hashReqKey;
      }
      if (currency) normalized.originalCurrency = currency;
      return normalized;
    })
    .filter(Boolean);
}
