import type { CrewTicket, CrewTicketFlightSnapshot } from "../models/crewTicket.model";
import type { FlightTicketData } from "../services/email";

type BookFlightPayload = {
  airlineName?: string;
  airlineCode?: string;
  originalCurrency?: string;
  legs?: unknown[];
  fares?: Array<{
    totalFare?: number;
    price?: number;
    cabin?: string;
    name?: string;
  }>;
};

function parseAirportName(name: string): { cityWithCode: string; code: string } {
  const match = name.match(/^(.+?)\s*\[([A-Z]+)\]/);
  if (match) {
    return { cityWithCode: `${match[1]} [${match[2]}]`, code: match[2] };
  }
  return { cityWithCode: name, code: "" };
}

/** Persist search/book flight payload on CrewTicket for ticket emails. */
export function buildFlightSnapshotFromBookPayload(
  flight: BookFlightPayload,
  currency: string,
  displayPrice: number
): CrewTicketFlightSnapshot {
  const legs = (flight.legs ?? []).map((rawLeg) => {
    const leg = rawLeg as Record<string, unknown>;
    const itinerary = Array.isArray(leg.itinerary)
      ? leg.itinerary.map((rawSeg) => {
          const seg = rawSeg as Record<string, unknown>;
          return {
            airlineName: seg.airlineName as string | undefined,
            airlineCode: seg.airlineCode as string | undefined,
            flightNumber: seg.flightNumber as string | undefined,
            from: seg.from as string | undefined,
            to: seg.to as string | undefined,
            fromAirport: seg.fromAirport as string | undefined,
            toAirport: seg.toAirport as string | undefined,
            departureTime: seg.departureTime as string | undefined,
            arrivalTime: seg.arrivalTime as string | undefined,
            cabin: seg.cabin as string | undefined,
            baggage: seg.baggage as string | undefined,
            cabinBaggage: seg.cabinBaggage as string | undefined,
          };
        })
      : [];

    return {
      from: leg.from as string | undefined,
      to: leg.to as string | undefined,
      departureTime: leg.departureTime as string | undefined,
      arrivalTime: leg.arrivalTime as string | undefined,
      duration: leg.duration as string | undefined,
      airlineName: leg.airlineName as string | undefined,
      airlineCode: leg.airlineCode as string | undefined,
      itinerary,
    };
  });

  const fareCabin = flight.fares?.[0]?.cabin;

  return {
    airlineName: flight.airlineName ?? legs[0]?.airlineName,
    airlineCode: flight.airlineCode ?? legs[0]?.airlineCode,
    legs,
    fares: [
      {
        totalFare: displayPrice,
        cabin: fareCabin,
        name: flight.fares?.[0]?.name,
      },
    ],
    currency: currency || flight.originalCurrency || "GBP",
  };
}

/** Map stored CrewTicket (with optional snapshot) to email FlightTicketData. */
export function buildFlightTicketDataFromCrewTicket(
  ticket: CrewTicket
): { flight: FlightTicketData; currency: string } {
  if (ticket.flightSnapshot && ticket.flightSnapshot.legs.length > 0) {
    const snap = ticket.flightSnapshot;
    return {
      flight: {
        id: ticket.id,
        airlineName: snap.airlineName ?? "Marine Flight",
        airlineCode: snap.airlineCode,
        legs: snap.legs,
        fares: snap.fares,
      },
      currency: snap.currency ?? "GBP",
    };
  }

  const fromParsed = parseAirportName(ticket.from?.Name ?? "");
  const toParsed = parseAirportName(ticket.to?.Name ?? "");
  const fromName = fromParsed.cityWithCode || ticket.from?.Name || "—";
  const toName = toParsed.cityWithCode || ticket.to?.Name || "—";
  const depIso = ticket.travelStart?.toISOString();
  const arrIso = ticket.travelEnd?.toISOString();

  return {
    flight: {
      id: ticket.id,
      airlineName: "Marine Flight",
      legs: [
        {
          from: fromParsed.code || fromName,
          to: toParsed.code || toName,
          departureTime: depIso,
          arrivalTime: arrIso,
          duration: ticket.trip === "ROUND_TRIP" ? "Round trip" : "One way",
          itinerary: [
            {
              from: fromParsed.code || fromName,
              to: toParsed.code || toName,
              fromAirport: fromName,
              toAirport: toName,
              departureTime: depIso,
              arrivalTime: arrIso,
              cabin: ticket.class,
            },
          ],
        },
      ],
      fares: [{ cabin: ticket.class, totalFare: ticket.price }],
    },
    currency: "GBP",
  };
}
