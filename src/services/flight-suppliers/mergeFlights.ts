import type { FlightSupplierId } from "./travelTerminus.service";

/** Tag every flight with a supplier id (defaults to riya for legacy results). */
export function tagSupplier(flights: any[], supplier: FlightSupplierId): any[] {
  return flights.map((flight) => ({
    ...flight,
    supplier: flight?.supplier ?? supplier,
    id:
      supplier === "travelterminus" && typeof flight?.id === "string" && !flight.id.startsWith("tt-")
        ? `tt-${flight.id}`
        : flight?.id,
  }));
}

function bestPrice(flight: any): number {
  const fares = Array.isArray(flight?.fares) ? flight.fares : [];
  const prices = fares
    .map((fare: any) => Number(fare?.price ?? fare?.totalFare))
    .filter((n: number) => Number.isFinite(n));
  return prices.length ? Math.min(...prices) : Number.POSITIVE_INFINITY;
}

function durationMinutes(flight: any): number {
  if (Number.isFinite(flight?._durationMinutes)) return Number(flight._durationMinutes);
  const legs = Array.isArray(flight?.legs) ? flight.legs : [];
  let total = 0;
  for (const leg of legs) {
    const match = String(leg?.duration || "").match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/i);
    if (match) total += Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
    else {
      const dep = new Date(leg?.departureTime).getTime();
      const arr = new Date(leg?.arrivalTime).getTime();
      if (Number.isFinite(dep) && Number.isFinite(arr) && arr > dep) {
        total += Math.round((arr - dep) / 60_000);
      }
    }
  }
  return total || Number.POSITIVE_INFINITY;
}

/**
 * Default rank when the client does not send sortBy:
 * shorter duration first, then lower price.
 */
export function rankByDurationThenPrice(flights: any[]): any[] {
  return [...flights].sort((a, b) => {
    const d = durationMinutes(a) - durationMinutes(b);
    if (d !== 0) return d;
    return bestPrice(a) - bestPrice(b);
  });
}

/** Strip internal ranking helpers before sending to the client. */
export function stripInternalFlightFields(flights: any[]): any[] {
  return flights.map((flight) => {
    if (!flight || typeof flight !== "object") return flight;
    const { _durationMinutes, fareBreakdown, supplierMeta, ...rest } = flight;
    void _durationMinutes;
    void fareBreakdown;
    void supplierMeta;
    return rest;
  });
}

export function resolveSupplierFromFlight(flight: {
  id?: string;
  supplier?: string;
}): FlightSupplierId {
  const raw = String(flight?.supplier || "").toLowerCase();
  if (raw === "travelterminus" || raw === "travel_terminus" || raw === "tt") {
    return "travelterminus";
  }
  if (raw === "riya" || raw === "riya_marine" || raw === "riya-marine") return "riya";
  if (typeof flight?.id === "string" && flight.id.startsWith("tt-")) return "travelterminus";
  return "riya";
}
