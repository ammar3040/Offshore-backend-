import { Response } from "express";
import { randomUUID } from "crypto";

import mongoose from "mongoose";
import {
  createCrewTicket,
  deleteCrewTicket,
  findCrewTicketByProjectAndCrew,
  findCrewTicketById,
  findAllCrewTickets,
  findCrewTicketsByCrewId,
  findCrewByCrewId,
  findProjectById,
  updateCrewTicket,
} from "../models";
import { CabinClass, TripType } from "../models/crewTicket.model";
import { convert, fetchRates, type CurrencyCode, type ExchangeRates } from "../lib/currency";
import { getAdminSettings } from "../lib/admin-settings";
import { sendFlightTicketEmail, type FlightTicketData } from "../services/email";

export async function getCrewTickets(_req: import("express").Request, res: Response) {
  try {
    const tickets = await findAllCrewTickets();
    return res.json({ crewTickets: tickets });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching crew tickets:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function getCrewTicketsByCrewId(
  req: import("express").Request<{ id: string }>,
  res: Response
) {
  try {
    const crewId = req.params.id; // id param is crew_id
    const tickets = await findCrewTicketsByCrewId(crewId);
    return res.json({ crewTickets: tickets });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching crew tickets:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function getCrewTicketById(
  req: import("express").Request<{ id: string }>,
  res: Response
) {
  try {
    const { id } = req.params;
    const ticket = await findCrewTicketById(id);
    if (!ticket) {
      return res.status(404).json({ message: "Crew ticket not found." });
    }
    return res.json({ crewTicket: ticket });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching crew ticket:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function postCrewTicket(req: import("express").Request, res: Response) {
  try {
    const body = req.body as {
      crew_id: string;
      project_id: string;
      from: { Name: string; COUNTRY: string; COUNTRYNAME: string };
      to: { Name: string; COUNTRY: string; COUNTRYNAME: string };
      class: string;
      adult: number;
      children?: number;
      infants?: number;
      trip: string;
    };

    if (!mongoose.Types.ObjectId.isValid(body.crew_id)) {
      return res.status(400).json({ message: "Invalid crew_id." });
    }
    if (!mongoose.Types.ObjectId.isValid(body.project_id)) {
      return res.status(400).json({ message: "Invalid project_id." });
    }

    const [project, crew] = await Promise.all([
      findProjectById(body.project_id),
      findCrewByCrewId(body.crew_id),
    ]);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }
    if (!crew) {
      return res.status(404).json({ message: "Crew not found." });
    }

    const existing = await findCrewTicketByProjectAndCrew(body.project_id, body.crew_id);
    if (existing) {
      return res.status(409).json({
        message: "A crew ticket already exists for this project and crew.",
      });
    }

    const ticket = await createCrewTicket({
      crew_id: new mongoose.Types.ObjectId(body.crew_id),
      project_id: new mongoose.Types.ObjectId(body.project_id),
      from: body.from,
      to: body.to,
      class: body.class as import("../models/crewTicket.model").CabinClass,
      adult: body.adult,
      children: body.children ?? 0,
      infants: body.infants ?? 0,
      trip: body.trip as import("../models/crewTicket.model").TripType,
    });

    return res.status(201).json({
      message: "Crew ticket created successfully.",
      crewTicket: ticket,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error creating crew ticket:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function uploadTicketPdf(
  req: import("express").Request<{ id: string }> & { uploadedPdfUrl?: string },
  res: Response
) {
  try {
    const { id } = req.params;
    const pdfUrl = req.uploadedPdfUrl;
    if (!pdfUrl) {
      return res.status(400).json({ message: "PDF upload failed or no file provided." });
    }
    const ticket = await updateCrewTicket(id, { pdf: pdfUrl });
    if (!ticket) {
      return res.status(404).json({ message: "Crew ticket not found." });
    }
    return res.status(200).json({
      message: "Ticket PDF uploaded successfully.",
      crewTicket: ticket,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error uploading ticket PDF:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function patchCrewTicket(
  req: import("express").Request<{ id: string }>,
  res: Response
) {
  try {
    const { id } = req.params;
    const body = req.body as Partial<{
      from: { Name: string; COUNTRY: string; COUNTRYNAME: string };
      to: { Name: string; COUNTRY: string; COUNTRYNAME: string };
      class: CabinClass;
      adult: number;
      children: number;
      infants: number;
      trip: TripType;
    }>;

    const updateData: Partial<Omit<import("../models/crewTicket.model").CrewTicket, "id" | "crew_id" | "project_id">> = {};
    if (body.from !== undefined) updateData.from = body.from;
    if (body.to !== undefined) updateData.to = body.to;
    if (body.class !== undefined) updateData.class = body.class;
    if (body.adult !== undefined) updateData.adult = body.adult;
    if (body.children !== undefined) updateData.children = body.children;
    if (body.infants !== undefined) updateData.infants = body.infants;
    if (body.trip !== undefined) updateData.trip = body.trip;

    const ticket = await updateCrewTicket(id, updateData);
    if (!ticket) {
      return res.status(404).json({ message: "Crew ticket not found." });
    }
    return res.json({ message: "Crew ticket updated successfully.", crewTicket: ticket });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error updating crew ticket:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

// Parse airport string "City [CODE] - Full Name, CountryName" -> AirportLocation
const COUNTRY_CODE_MAP: Record<string, string> = {
  India: "IN",
  "United Arab Emirates": "AE",
  UAE: "AE",
  "United States": "US",
  USA: "US",
  "United Kingdom": "GB",
  UK: "GB",
  Thailand: "TH",
  Singapore: "SG",
  Malaysia: "MY",
  "Saudi Arabia": "SA",
  Qatar: "QA",
  Oman: "OM",
  Bahrain: "BH",
  Kuwait: "KW",
  Indonesia: "ID",
  "Sri Lanka": "LK",
  Bangladesh: "BD",
  Nepal: "NP",
  Pakistan: "PK",
};

function parseAirportFromString(str: string): { Name: string; COUNTRY: string; COUNTRYNAME: string } {
  if (!str || typeof str !== "string") {
    return { Name: "", COUNTRY: "", COUNTRYNAME: "" };
  }
  // "Mumbai [BOM] - Chhatrapati Shivaji..., India" or "Delhi NCR [DEL] - Indira Gandhi..., India"
  const beforeDash = str.split(" - ")[0]?.trim() || "";
  const name = beforeDash || str;
  const countryMatch = str.match(/,\s*([^,]+)$/);
  const countryName = countryMatch ? countryMatch[1].trim() : "";
  const countryCode = COUNTRY_CODE_MAP[countryName] || countryName.slice(0, 2).toUpperCase() || "XX";
  return { Name: name, COUNTRY: countryCode, COUNTRYNAME: countryName };
}

// Map cabin string "S - Economy" -> CabinClass
function cabinToClass(cabin: string): CabinClass {
  if (!cabin) return CabinClass.Economy;
  const c = cabin.toLowerCase();
  if (c.includes("first") || c.includes("f -")) return CabinClass.FirstClass;
  if (c.includes("business") || c.includes("c -")) return CabinClass.Business;
  if (c.includes("premium") || c.includes("w -")) return CabinClass.PremiumEconomy;
  return CabinClass.Economy;
}

export async function bookFlight(req: import("express").Request, res: Response) {
  try {
    const body = req.body as {
      project_id: string;
      crew_ids: string[];
      flight: {
        id: string;
        legs: Array<{
          itinerary?: Array<{
            fromAirport?: string;
            toAirport?: string;
          }>;
        }>;
        fares?: Array<{ cabin?: string }>;
      };
      adult?: number;
      children?: number;
      infants?: number;
    };

    if (!mongoose.Types.ObjectId.isValid(body.project_id)) {
      return res.status(400).json({ message: "Invalid project_id." });
    }

    const project = await findProjectById(body.project_id);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const fl = body.flight;
    const flightId = fl.id;
    const firstLeg = fl.legs[0];
    const firstItinerary = firstLeg?.itinerary?.[0];
    const from = parseAirportFromString(firstItinerary?.fromAirport || "");
    const to = parseAirportFromString(firstItinerary?.toAirport || "");
    const cabinClass = cabinToClass(fl.fares?.[0]?.cabin || "");
    const legCount = fl.legs?.length ?? 1;
    const trip = legCount > 1 ? TripType.RoundTrip : TripType.OneWay;
    const adult = body.adult ?? 1;
    const children = body.children ?? 0;
    const infants = body.infants ?? 0;

    if (!from.Name || !to.Name) {
      return res.status(400).json({
        message:
          "Could not extract from/to from flight.legs[0].itinerary[0].fromAirport and toAirport.",
      });
    }

    const created: import("../models/crewTicket.model").CrewTicket[] = [];
    const errors: { crew_id: string; message: string }[] = [];

    for (const crewId of body.crew_ids) {
      if (!mongoose.Types.ObjectId.isValid(crewId)) {
        errors.push({ crew_id: crewId, message: "Invalid crew_id." });
        continue;
      }

      const crew = await findCrewByCrewId(crewId);
      if (!crew) {
        errors.push({ crew_id: crewId, message: "Crew not found." });
        continue;
      }

      const existing = await findCrewTicketByProjectAndCrew(body.project_id, crewId);
      if (existing) {
        errors.push({
          crew_id: crewId,
          message: "A crew ticket already exists for this project and crew.",
        });
        continue;
      }

      const ticket = await createCrewTicket({
        crew_id: new mongoose.Types.ObjectId(crewId),
        project_id: new mongoose.Types.ObjectId(body.project_id),
        from,
        to,
        class: cabinClass,
        adult,
        children,
        infants,
        trip,
      });
      created.push(ticket);

      try {
        const currency = (body.flight as { originalCurrency?: string }).originalCurrency ?? "INR";
        await sendFlightTicketEmail(crew.email, crew.firstname, body.flight as FlightTicketData, currency);
      } catch (emailErr) {
        console.error(`Failed to send flight ticket email to ${crew.email}:`, emailErr);
      }
    }

    return res.status(201).json({
      message:
        created.length > 0
          ? `Crew ticket(s) created successfully for ${created.length} crew.`
          : "No crew tickets created.",
      crewTickets: created,
      flightId,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error booking flight:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function deleteCrewTicketHandler(
  req: import("express").Request<{ id: string }>,
  res: Response
) {
  try {
    const { id } = req.params;
    const deleted = await deleteCrewTicket(id);
    if (!deleted) {
      return res.status(404).json({ message: "Crew ticket not found." });
    }
    return res.json({ message: "Crew ticket deleted successfully." });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error deleting crew ticket:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

const RIYA_URL = "https://caching.corp.riya.travel/api/Search_TrvlNxtAPI";

// Mapping for cabin classes (request body uses lowercase keys)
const CABIN_CLASS_MAP: Record<string, string> = {
  economy: "Y",
  premium_economy: "W",
  business: "C",
  first: "F",
  // Support enum values from backend
  ECONOMY: "Y",
  PREMIUM_ECONOMY: "W",
  BUSINESS: "C",
  FIRST_CLASS: "F",
};

function parseAirport(airport: { Name?: string } | null): { code: string; city: string; cityWithCode: string } {
  if (!airport || !airport.Name) return { code: "", city: "", cityWithCode: "" };
  const match = airport.Name.match(/^(.+?)\s*\[([A-Z]+)\]/);
  if (match) {
    return {
      city: match[1],
      code: match[2],
      cityWithCode: `${match[1]} [${match[2]}]`,
    };
  }
  return { code: "", city: "", cityWithCode: airport.Name };
}

function transformJourneySegments(segments: any[], totalTimeStopOver: string) {
  if (!segments || segments.length === 0) return null;
  const firstSegment = segments[0];
  const lastSegment = segments[segments.length - 1];

  const itinerary = segments.map((seg: any, sIdx: number) => {
    const nextSeg = segments[sIdx + 1];
    let layover = null;
    if (nextSeg) {
      const arrTime = new Date(seg.ArrivalDateTime);
      const depTime = new Date(nextSeg.DepartureDateTime);
      const diffMs = depTime.getTime() - arrTime.getTime();
      const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      layover = { location: seg.ToLocation, duration: `${diffHrs}h ${diffMins}m` };
    }
    return {
      airlineName: seg.AirlineName,
      airlineCode: seg.Carrier,
      flightNumber: seg.FlightNumber,
      from: seg.FromLocation,
      fromAirport: seg.FromAirport,
      fromTerminal: seg.FromTerminal,
      to: seg.ToLocation,
      toAirport: seg.ToAirport,
      toTerminal: seg.ToTerminal,
      departureTime: seg.DepartureDateTime,
      arrivalTime: seg.ArrivalDateTime,
      duration: seg.Duration || "Unknown",
      cabin: seg.Cabin,
      baggage: seg.Weight ? `${seg.Weight} ${seg.Unit}` : "No info",
      cabinBaggage: seg.cabinbaggage || "No info",
      layover,
    };
  });

  const [hours, minutes] = totalTimeStopOver.split(":").map(Number);
  const duration = minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;

  return {
    airlineName: firstSegment.AirlineName,
    airlineCode: firstSegment.Carrier,
    from: firstSegment.FromLocation,
    to: lastSegment.ToLocation,
    departureTime: firstSegment.DepartureDateTime,
    arrivalTime: lastSegment.ArrivalDateTime,
    duration,
    stops: segments.length - 1,
    via: segments.length > 1 ? segments[0].ToLocation : null,
    itinerary,
  };
}

function transformRiyaResponse(data: any, origin: string, destination: string) {
  const hasRT = data?.lstJourneyRoundTrip && data.lstJourneyRoundTrip.length > 0;
  const rawJourneys = hasRT ? data.lstJourneyRoundTrip : (data?.lstJourneyOneWay || []);

  return rawJourneys
    .map((journey: any, index: number) => {
      const allSegments = journey.lstItinerary || [];
      if (allSegments.length === 0) return null;

      const legs: any[] = [];
      let currentSegments: any[] = [];

      for (let i = 0; i < allSegments.length; i++) {
        currentSegments.push(allSegments[i]);
        if (i < allSegments.length - 1) {
          const current = allSegments[i];
          const next = allSegments[i + 1];
          const curTo = current.ToLocation || "";
          const nextFrom = next.FromLocation || "";
          const reachedDestination = curTo === destination || curTo.includes(`[${destination}]`);
          const returnsToOrigin =
            (nextFrom === origin || nextFrom.includes(`[${origin}]`)) && i > 0;
          const isPathBroken = curTo !== nextFrom;

          if (reachedDestination || returnsToOrigin || isPathBroken) {
            const totalTime: string = currentSegments[0]?.TotalTimeStopOver || "00:00";
            legs.push(transformJourneySegments(currentSegments, totalTime));
            currentSegments = [];
          }
        }
      }
      if (currentSegments.length > 0) {
        const totalTime: string = currentSegments[0]?.TotalTimeStopOver || "00:00";
        legs.push(transformJourneySegments(currentSegments, totalTime));
      }

      const firstSegment = allSegments[0];
      const simplifiedFares = (journey.AllFareType || []).map((fare: any) => {
        const fareType = fare.FareType || "";
        const rawIndicator = (fare.FareIndicaters || "").toUpperCase();
        let indicator = "N";
        if (fareType === "Marine" || rawIndicator.includes("MARINE") || rawIndicator === "M") {
          indicator = "M";
        } else if (rawIndicator.includes("SME")) {
          indicator = "SM";
        } else if (rawIndicator === "F" || rawIndicator.includes("FLEX")) {
          indicator = "F";
        } else if (
          rawIndicator === "N" ||
          rawIndicator.includes("SAVER") ||
          rawIndicator.includes("NORMAL")
        ) {
          indicator = "N";
        }
        return {
          type: fare.FareType,
          name: fare.FareIndicaters || fare.FareType,
          indicator,
          totalFare: fare.TotalFare,
          basicFare: fare.FareAmount,
          seats:
            firstSegment.NoOfSeats?.replace("Hurry!! Only ", "")
              .replace(" Left", "")
              .replace(" Seats", "")
              .replace(" Seat", "")
              .trim() || "Available",
          cabin: fare.Cabin,
        };
      });

      return {
        id: `${firstSegment.Trackid || "flight"}-${index}-${firstSegment.DepartureDateTime.replace(/[:T-]/g, "")}`,
        legs: legs.filter(Boolean),
        fares: simplifiedFares,
        fareBreakdown: {
          total: firstSegment.TotalPrice,
          base: firstSegment.BasicFare,
          tax: firstSegment.TotalTax,
          serviceFee: firstSegment.ServiceeFee,
          gst: firstSegment.GST,
        },
        airlineName: legs[0]?.airlineName || firstSegment.AirlineName,
        airlineCode: legs[0]?.airlineCode || firstSegment.Carrier,
        stops: Math.max(...legs.map((l) => l.stops)),
        originalCurrency: journey.Currency || "INR",
      };
    })
    .filter(Boolean);
}

async function fetchRiya(payload: any) {
  const response = await fetch(RIYA_URL, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      "content-type": "application/json;charset=UTF-8",
      origin: "https://marinecorp.riya.travel",
      pragma: "no-cache",
      referer: "https://marinecorp.riya.travel/",
      "user-agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) return null;
  return response.json();
}

const AIRLINE_LIST_STRING =
  process.env.AIRLINE_LIST_STRING ||
  "0B,0V,0Y,1A,1B,1E,1F,1G,1H,1M,1N,1P,1S,1T,1U,1V,1Y,2A,2B,2D,2F,2G,2H,2I,2J,2K,2L,2M,2P,2S,2T,2V,2W,2X,2Z,3A,3B,3C,3E,3H,3J,3K,3L,3M,3N,3O,3P,3S,3T,3U,3V,3W,4B,4C,4D,4G,4M,4N,4O,4P,4U,4V,4Y,4Z,5B,5D,5F,5J,5N,5O,5P,5Q,5S,5T,5U,5V,5W,5Z,6A,6B,6C,6E,6H,6I,6O,6R,6S,6X,7C,7F,7G,7H,7J,7P,7Q,7R,7S,7V,7W,7X,7Y,8B,8D,8F,8H,8I,8L,8M,8P,8Q,8R,8S,8U,8W,8X,8Y,8Z,9B,9C,9D,9E,9F,9H,9I,9J,9K,9M,9N,9P,9R,9S,9U,9V,9X,A2,A3,A4,A5,A6,A9,AA,AC,AD,AE,AF,AG,AH,AI,AK,AM,AN,AP,AQ,AR,AS,AT,AU,AV,AW,AY,AZ,B0,B2,B3,B4,B5,B6,B7,B8,B9,BA,BB,BC,BD,BE,BF,BG,BI,BJ,BK,BL,BP,BQ,BR,BS,BT,BU,BV,BW,BX,BY,BZ,C1,C2,C5,C6,C8,CA,CC,CD,CE,CG,CI,CL,CM,CN,CP,CU,CW,CX,CY,CZ,D2,D3,D4,D7,D8,D9,DD,DE,DG,DK,DL,DM,DO,DP,DQ,DR,DT,DV,DX,DY,DZ,E3,E4,E5,E7,E9,EB,EI,EK,EL,EN,EO,EP,EQ,ER,ES,ET,EU,EW,EX,EY,F1,F2,F7,F8,F9,FA,FB,FC,FD,FE,FG,FH,FI,FJ,FL,FM,FN,FO,FP,FR,FS,FT,FU,FV,FY,FZ,G3,G4,G5,G6,G7,G8,G9,GA,GD,GE,GF,GH,GJ,GK,GL,GM,GP,GQ,GR,GS,GT,GU,GX,GY,GZ,H2,H4,H8,H9,HA,HB,HC,HD,HF,HG,HH,HJ,HM,HN,HO,HP,HR,HU,HV,HX,HY,HZ,I1,I2,I3,I5,I6,I8,IA,IB,ID,IE,IF,IH,IJ,IK,IN,IO,IQ,IR,IS,IT,IW,IX,IY,IZ,J2,J4,J7,J8,J9,JA,JD,JE,JI,JJ,JL,JM,JP,JQ,JR,JS,JT,JU,JV,JX,JY,JZ,K6,K7,KA,KB,KC,KE,KF,KG,KL,KM,KN,KP,KQ,KR,KS,KU,KX,KY,L5,L6,L8,LA,LF,LG,LH,LI,LJ,LL,LM,LN,LO,LP,LQ,LR,LS,LT,LU,LV,LW,LX,LY,M0,M5,M9,MD,ME,MF,MG,MH,MJ,MK,ML,MM,MN,MO,MQ,MR,MS,MU,MV,MW,MX,MY,N3,N4,N5,N8,NA,NB,ND,NE,NF,NG,NH,NI,NK,NL,NM,NO,NP,NS,NT,NU,NX,NZ,O2,O4,O6,O7,OA,OB,OD,OG,OH,OK,OL,OM,ON,OO,OP,OQ,OR,OS,OT,OU,OV,OX,OZ,P0,P4,P5,PA,PB,PC,PD,PE,PF,PG,PI,PJ,PK,PM,PN,PQ,PR,PS,PT,PU,PW,PX,PY,PZ,Q2,Q4,Q6,QB,QC,QD,QF,QH,QK,QL,QP,QR,QS,QU,QV,QW,QX,QZ,R2,R3,R5,RA,RB,RC,RD,RF,RG,RI,RJ,RL,RM,RN,RO,RQ,RS,RT,RV,RW,RX,RY,RZ,S4,S5,S6,S7,S8,SA,SB,SC,SD,SE,SF,SI,SJ,SK,SL,SM,SN,SO,SP,SQ,SS,ST,SU,SV,SW,SY,SZ,T0,T3,T5,T7,T9,TA,TB,TC,TD,TF,TG,TJ,TK,TL,TM,TN,TO,TP,TR,TS,TT,TU,TV,TW,TX,TY,TZ,U2,U5,U6,U8,UA,UB,UD,UE,UF,UG,UH,UJ,UK,UL,UM,UO,UP,UQ,UR,UT,UU,UX,UY,UZ,V0,V3,V7,VA,VB,VC,VF,VG,VH,VJ,VL,VN,VQ,VR,VS,VT,VU,VV,VW,VX,VY,VZ,W2,W3,W4,W5,W6,W9,WB,WE,WF,WG,WH,WI,WJ,WM,WN,WO,WS,WT,WV,WX,WY,WZ,X3,X4,X6,XE,XF,XJ,XK,XL,XQ,XR,XS,XY,XZ,Y1,Y2,Y4,Y5,Y7,Y8,Y9,YC,YI,YK,YL,YM,YN,YO,YT,YU,YV,YW,YX,Z2,Z3,Z7,Z8,ZA,ZB,ZD,ZE,ZF,ZG,ZH,ZL,ZM,ZN,ZP,ZT,ZW";

export async function searchFlights(req: import("express").Request, res: Response) {
  try {
    const payload = req.body;

    const response = await fetch(RIYA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://marinecorp.riya.travel",
        "Referer": "https://marinecorp.riya.travel/"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data
      });
    }

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error) {
    console.error("Riya API Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: (error as Error).message
    });
  }
};

function buildPayload(
  fC: string,
  tC: string,
  fA: string,
  tA: string,
  date: string,
  fromCountry: string,
  toCountry: string,
  opts: {
    adults: number;
    children: number;
    infants: number;
    cabinClass: string;
    currency: string;
    sector: string;
  }
) {
  const today = new Date();
  const bookResDate = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;
  return {
    CacheRefreshFlag: false,
    UseCacheServerFlag: true,
    OnePNRFlag: false,
    CachedOn: "0001-01-01T00:00:00",
    ExpiredOn: "0001-01-01T00:00:00",
    CachedExpiredOn: "0001-01-01T00:00:00",
    travelFrom: fC,
    travelTo: tC,
    DepDate: date,
    returnDatemultifare: "0001-01-01T00:00:00",
    cacheflag: 0,
    returnDate: "0001-01-01T00:00:00",
    travClass: CABIN_CLASS_MAP[opts.cabinClass] || "Y",
    returnFrom: "",
    noOfAdult: opts.adults,
    noOfChild: opts.children,
    noOfInfant: opts.infants,
    Sector: opts.sector,
    cacheSpecialSector: false,
    travelFromAirport: fA,
    travelToAirport: tA,
    ROE: 0,
    ROE1: 0,
    ROE2: 0,
    OnlineCancellation: false,
    Flag: "IN",
    CorporateROE: 1,
    AgentROE: 1,
    AgentCurrency: opts.currency,
    BaseCurrency: opts.currency,
    User: "Agent",
    AirArabia: true,
    FlyDubai: true,
    UserType: "MN",
    AirArabia3L: true,
    SessionTimeOut: 0,
    Isfarerevised: false,
    MistifyROE: 0,
    AirArabiaROE: 0,
    GoAirROE: 0,
    SpicejetROE: 0,
    IndigoROE: 0,
    AmadeusROE: 0,
    STSROE: 0,
    PKFROE: 0,
    AERTicketROE: 0,
    AIETicketROE: 0,
    IndigoMarineROE: 0,
    SpicejetMarineROE: 0,
    AirArabia3LROE: 0,
    FlyDubaiROE: 0,
    PegasusROE: 0,
    SalamROE: 0,
    Commission: 0,
    CorporateCountry: "IN",
    JazeeraROE: 0,
    APIROEJazeera: 0,
    CorporateCurrency: opts.currency,
    FromCountry: fromCountry,
    ToCountry: toCountry,
    AirArabia2ROE: 0,
    SearchID: randomUUID(),
    CorporateID: "377",
    StaffAgentID: "",
    Action: 0,
    RequestTime: "0001-01-01T00:00:00",
    ResponseTime: "0001-01-01T00:00:00",
    id: 0,
    index: 0,
    index_1: 0,
    index_2: 0,
    RTIndex: 0,
    AirlineList: [{ objAirlineList: AIRLINE_LIST_STRING }],
    newofficeid: [
      {
        objnewofficeid: "BOMVS34AD",
        TicketingPCC: "BOMVS34AD",
        Emails: "",
        QueueNo: "",
        OTPNo: "",
        TicketingAccess: true,
      },
    ],
    pricingcodeofficeid: [
      {
        objnewofficeid: "BOMVS34AD",
        TicketingPCC: "BOMVS34AD",
        Emails: "",
        QueueNo: "",
        OTPNo: "",
        TicketingAccess: true,
        CRSType: "10",
        Airlines: "KQ",
      },
    ],
    pricingcodeROE: [],
    newROE: [{ objnewROE: 0 }],
    pricingcodeList: [{ objpricingcode: "752375," }],
    hdFSFlag: 0,
    chkNonStop: false,
    chk1Stop: false,
    chk2Stop: false,
    IsHost: false,
    SearchTimeID: 0,
    SearchTimePKID: 0,
    marineCorporatefare: true,
    AirArabiaOfficeID: "MARINERIYAAPI",
    STSOfficeID: "RABOM0300062",
    IndigoAllOfficeId: ["14398855E", "KMBOM0002"],
    SpicejetAllOfficeId: ["MARNW00015"],
    AkasaAirAllOfficeId: ["QPBOM5001M_01", "QPBOM5001H_01"],
    AirAsiaROE: 0,
    AirAsia: true,
    AirAsiaMarineROE: 0,
    lstCitySearch: [{ travelFrom: fC, travelTo: tC, DepDate: date, MinPrice: 0, MaxPrice: 0 }],
    splfareflag: false,
    AIExpressROE: 0,
    SearchTypeFlag: "OW",
    TicketingAccess: true,
    CebuPacific: 0,
    TravelFusionROE: 0,
    CorporateCustID: "ADHCUST107890A",
    GroupID: "286",
    AmadeusTransactionStatusCode: "Start",
    MultiDepDate_1: "0001-01-01T00:00:00",
    MultiDepDate_2: "0001-01-01T00:00:00",
    MultiDepDate_3: "0001-01-01T00:00:00",
    tabIndex: 0,
    DepDate_1: "0001-01-01T00:00:00",
    DepDate_2: "0001-01-01T00:00:00",
    INDESKBOOKING: true,
    COORDINATOR: "N",
    TRIPOPTION: false,
    PERSONALBOOKING: false,
    ComplainceFare: "N|",
    ComparableHrs: "N|",
    PolicyNonpolicy: "N||",
    DomBookingRestrictCount: "0",
    InterBookingRestrictCount: 0,
    ClassTypes: "E|B|F",
    AppType: "CBT",
    AIRPORTTYPE: opts.sector,
    CORPORATECODE: "C000374",
    TRIPTYPE: opts.sector,
    AddTripSelectedFare: 0,
    Approverlimit: 0,
    Travellerlimit: 0,
    domestickbookresdate: bookResDate,
    bookflag: true,
    interbookresdate: bookResDate,
    EmpID: "1227",
    EmpMailID: "1227",
    Bookedusertype: "CBT",
    Corporate_Code: "C000374",
    AgentID: "377",
    AgentCustID: "C000374",
    AgentCountry: "IN",
    Entity: "401",
    isAllowBusinessTrip: false,
    availcount: 0,
    Noofresult: 0,
  };
}

export async function searchFlightsController(req: import("express").Request, res: Response) {
  try {
    const body = req.body;
    const {
      tripType = "one-way",
      from,
      to,
      departureDate,
      returnDate,
      adults = 1,
      children = 0,
      infants = 0,
      cabinClass = "economy",
      currency = "GBP",
      project_id,
      crew_ids,
      page = 1,
      limit = 20,
    } = body;

    const crewIdsArray = Array.isArray(crew_ids) ? crew_ids : [];

    const adminSettings = await getAdminSettings();

    let rates: ExchangeRates;
    try {
      rates = await fetchRates();
    } catch (error: unknown) {
      console.error("Currency Fetch Error:", error);
      return res.status(500).json({
        error: `Currency Error: ${error instanceof Error ? error.message : "Could not fetch live rates"}`,
      });
    }

    const applyAdminLogic = (flights: any[]) => {
      const baseCurrency = adminSettings.baseCurrency || "GBP";
      const requestedCurrency = currency as CurrencyCode;
      const localFlatMarkup = convert(
        adminSettings.pricing.flatMarkup || 0,
        baseCurrency as CurrencyCode,
        requestedCurrency,
        rates
      );
      const localFlatCashback = convert(
        adminSettings.incentives.flatCashback || 0,
        baseCurrency as CurrencyCode,
        requestedCurrency,
        rates
      );

      const airlineIncentivesMap = new Map<string, number>();
      (adminSettings.incentives.airlineSpecific || []).forEach((a) => {
        const airlines = a.airlines ?? (a.airline ? [a.airline] : []);
        if (airlines.length > 0 && a.incentive) {
          const localIncentive = convert(
            a.incentive,
            baseCurrency as CurrencyCode,
            requestedCurrency,
            rates
          );
          airlines.forEach((code: string) => airlineIncentivesMap.set(code.toUpperCase(), localIncentive));
        }
      });

      return flights.map((flight) => {
        const originalCurrency = (flight.originalCurrency || "INR") as CurrencyCode;
        const airlineCode = (flight.airlineCode || "").toUpperCase();
        const airlineIncentive = airlineIncentivesMap.get(airlineCode) ?? 0;

        const updatedFares = flight.fares.map((fare: any) => {
          let price = convert(fare.totalFare, originalCurrency, requestedCurrency, rates);
          price += localFlatMarkup;
          price = price * (1 + (adminSettings.pricing.percentageMarkup || 0) / 100);
          return { ...fare, totalFare: Math.round(Math.max(0, price)) };
        });

        const cashback = airlineIncentive > 0 ? airlineIncentive : localFlatCashback;
        const { fareBreakdown, ...flightWithoutFareBreakdown } = flight;

        return {
          ...flightWithoutFareBreakdown,
          fares: updatedFares,
          cashback: cashback > 0 ? cashback : null,
          appliedIncentive: null,
        };
      });
    };

    const fromData = parseAirport(from);
    const toData = parseAirport(to);
    const sector = from?.COUNTRY === to?.COUNTRY ? "D" : "I";

    const formattedDepDate = departureDate ? `${departureDate}T00:00:00` : "0001-01-01T00:00:00";
    const formattedReturnDate =
      tripType === "round-trip" && returnDate ? `${returnDate}T00:00:00` : "0001-01-01T00:00:00";

    const opts = { adults, children, infants, cabinClass, currency, sector };

    if (tripType === "round-trip") {
      const [outboundData, inboundData] = await Promise.all([
        fetchRiya(
          buildPayload(
            fromData.code,
            toData.code,
            fromData.cityWithCode,
            toData.cityWithCode,
            formattedDepDate,
            from?.COUNTRY || "IN",
            to?.COUNTRY || "IN",
            opts
          )
        ),
        fetchRiya(
          buildPayload(
            toData.code,
            fromData.code,
            toData.cityWithCode,
            fromData.cityWithCode,
            formattedReturnDate,
            to?.COUNTRY || "IN",
            from?.COUNTRY || "IN",
            opts
          )
        ),
      ]);

      const outResults = transformRiyaResponse(outboundData || {}, fromData.code, toData.code);
      const inResults = transformRiyaResponse(inboundData || {}, toData.code, fromData.code);

      const results: any[] = [];
      const minLen = Math.min(outResults.length, inResults.length);
      for (let i = 0; i < minLen; i++) {
        const o = outResults[i];
        const r = inResults[i];
        if (!o || !r) continue;

        results.push({
          ...o,
          id: `rt-${o.id}-${r.id}`,
          legs: [...o.legs, ...r.legs],
          fares: o.fares.map((f: any, fIdx: number) => {
            const rFare = r.fares[fIdx] ?? r.fares[0];
            return {
              ...f,
              totalFare: f.totalFare + rFare.totalFare,
              basicFare: f.basicFare + rFare.basicFare,
            };
          }),
          fareBreakdown: {
            total: o.fareBreakdown.total + r.fareBreakdown.total,
            base: o.fareBreakdown.base + r.fareBreakdown.base,
            tax: o.fareBreakdown.tax + r.fareBreakdown.tax,
            serviceFee: o.fareBreakdown.serviceFee + r.fareBreakdown.serviceFee,
            gst: o.fareBreakdown.gst + r.fareBreakdown.gst,
          },
          airlineName: o.legs[0]?.airlineName,
          airlineCode: o.legs[0]?.airlineCode,
          stops: o.stops + r.stops,
        });
      }
      const flights = applyAdminLogic(results);
      const total = flights.length;
      const totalPages = Math.ceil(total / limit);
      const startIndex = (page - 1) * limit;
      const paginatedFlights = flights.slice(startIndex, startIndex + limit);
      return res.json({
        project_id,
        crew_ids: crewIdsArray,
        flights: paginatedFlights,
        pagination: { page, limit, total, totalPages },
      });
    } else {
      const data = await fetchRiya(
        buildPayload(
          fromData.code,
          toData.code,
          fromData.cityWithCode,
          toData.cityWithCode,
          formattedDepDate,
          from?.COUNTRY || "IN",
          to?.COUNTRY || "IN",
          opts
        )
      );
      const transformedData = transformRiyaResponse(data || {}, fromData.code, toData.code);
      const flights = applyAdminLogic(transformedData);
      const total = flights.length;
      const totalPages = Math.ceil(total / limit);
      const startIndex = (page - 1) * limit;
      const paginatedFlights = flights.slice(startIndex, startIndex + limit);
      return res.json({
        project_id,
        crew_ids: crewIdsArray,
        flights: paginatedFlights,
        pagination: { page, limit, total, totalPages },
      });
    }
  } catch (error) {
    console.error("Error processing search request:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}