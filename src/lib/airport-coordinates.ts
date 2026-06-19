/** Lazy IATA → coordinates index from a public dataset (works on Vercel; airportroutes blocks datacenter IPs). */

type Coords = { lat: number; lng: number };

const AIRPORTS_JSON_URL =
  "https://raw.githubusercontent.com/mwgg/Airports/master/airports.json";

let iataIndex: Map<string, Coords> | null = null;
let loadPromise: Promise<Map<string, Coords>> | null = null;

async function loadIataIndex(): Promise<Map<string, Coords>> {
  if (iataIndex) return iataIndex;
  if (!loadPromise) {
    loadPromise = (async () => {
      const res = await fetch(AIRPORTS_JSON_URL);
      if (!res.ok) {
        throw new Error(`Airport coordinates fetch failed: ${res.status}`);
      }
      const data = (await res.json()) as Record<
        string,
        { iata?: string; lat?: number; lon?: number }
      >;
      const index = new Map<string, Coords>();
      for (const entry of Object.values(data)) {
        const iata = (entry.iata ?? "").trim().toUpperCase();
        if (
          iata.length === 3 &&
          typeof entry.lat === "number" &&
          typeof entry.lon === "number"
        ) {
          index.set(iata, { lat: entry.lat, lng: entry.lon });
        }
      }
      iataIndex = index;
      return index;
    })().catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  return loadPromise;
}

export async function getAirportCoordinatesByIata(
  code: string
): Promise<Coords | null> {
  const iata = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(iata)) return null;
  try {
    const index = await loadIataIndex();
    return index.get(iata) ?? null;
  } catch {
    return null;
  }
}

export function distanceKmBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const earthRadiusKm = 6371;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
