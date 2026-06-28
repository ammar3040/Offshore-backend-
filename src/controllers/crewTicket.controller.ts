import { Response, type Request } from "express";
import { randomUUID } from "crypto";

import mongoose from "mongoose";
import {
  createCrewTicket,
  deleteCrewTicket,
  findAdminById,
  findCrewTicketById,
  findAllCrewTicketsPaginated,
  findCrewTicketsByAdminIdPaginated,
  findCrewTicketsByCrewId,
  buildCrewTicketReportSpendsScopeFilter,
  findCrewTicketRowsForReportSpends,
  findCrewByCrewId,
  findProjectById,
  updateCrewTicket,
  updateCrewTicketPdfUrl,
  sumMarkupByProject,
  updateAdminBalance,
  updateAdminCancellationState,
} from "../models";
import { CabinClass, CrewTicketStatus, TripType, type CrewTicketListOptions } from "../models/crewTicket.model";
import { convert, fetchRates, type CurrencyCode, type ExchangeRates } from "../lib/currency";
import { getAdminSettings } from "../lib/admin-settings";
import { findFirstSuperAdmin } from "../models/superadmin.model";
import { projectRigObjectId } from "../models/project.model";
// import { sendFlightTicketEmail, sendTicketApprovalRequestEmail } from "../services/email";
import { sendTicketApprovalRequestEmail } from "../services/email";
import type { CrewTicket } from "../models/crewTicket.model";
// import { getSignedCloudinaryDeliveryUrl } from "../lib/cloudinary-asset";
import { generateAndUploadTicketPdf, resolveCrewTicketPdfBuffer } from "../services/ticketPdf";
import {
  buildFlightSnapshotFromBookPayload,
  buildFlightTicketDataFromCrewTicket,
} from "../lib/flight-snapshot";
import { fetchRiyaGetcity, normalizeRiyaAirports, type RiyaAirportItem } from "../lib/riya-airports";
import { distanceKmBetween, getAirportCoordinatesByIata } from "../lib/airport-coordinates";
import type { AuthenticatedRequest } from "../middleware/auth";
import {
  ACCESS_DENIED_MESSAGE,
  crewOwnedByCaller,
  isSuperAdmin,
  projectOwnedByCaller,
  projectOwnedByProject,
  resolveOptionalRigAttachment,
  ticketAccessibleByCaller,
} from "../lib/resource-access";
import {
  accrueCancellationDebtForDeletedCrewTicket,
  applyCancellationPaymentOnBook,
  cancellationInstallmentGbp,
  cancellationInstallmentInCurrency,
  revertCancellationAccrual,
} from "../services/cancellation-debt";
import { buildReportSpendsFromTickets } from "../services/crew-ticket-report-spends";

function refId(value: unknown): string {
  if (typeof value === "object" && value && "_id" in value) {
    return (value as { _id: { toString: () => string } })._id.toString();
  }
  return String(value);
}

function crewDisplayName(value: unknown): string {
  if (typeof value === "object" && value) {
    const crew = value as { firstname?: string; lastname?: string; email?: string };
    const name = [crew.firstname, crew.lastname].filter(Boolean).join(" ").trim();
    return name || crew.email || "Crew member";
  }
  return "Crew member";
}

function projectDisplayTitle(value: unknown): string {
  if (typeof value === "object" && value && "title" in value) {
    return (value as { title?: string }).title || "Project";
  }
  return "Project";
}

/** Strip private Cloudinary URLs from API payloads — clients must use pdfDownloadUrl. */
function withTicketPdfAccess<T extends CrewTicket>(
  ticket: T
): Omit<T, "pdf"> & { pdfDownloadUrl: string; hasPdf: boolean } {
  const { pdf, ...rest } = ticket;
  return {
    ...rest,
    hasPdf: Boolean(pdf),
    pdfDownloadUrl: `/crew-ticket/${ticket.id}/pdf`,
  };
}

function vesselDisplayName(ticket: CrewTicket): string {
  const rig = ticket.rig_id;
  if (typeof rig === "object" && rig && "name" in rig) {
    return (rig as { name?: string }).name || "—";
  }
  const project = ticket.project_id;
  if (typeof project === "object" && project && "rig_id" in project) {
    const projectRig = (project as { rig_id?: unknown }).rig_id;
    if (typeof projectRig === "object" && projectRig && "name" in projectRig) {
      return (projectRig as { name?: string }).name || "—";
    }
  }
  return projectDisplayTitle(project);
}

export async function getCrewTickets(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { page, limit, status } = req.query as {
      page?: number;
      limit?: number;
      status?: CrewTicketStatus;
    };
    const options: CrewTicketListOptions = { page, limit, status };

    const result = isSuperAdmin(role)
      ? await findAllCrewTicketsPaginated(options)
      : await findCrewTicketsByAdminIdPaginated(userId, options);

    const payload: { crewTickets: ReturnType<typeof withTicketPdfAccess>[]; pagination?: typeof result.pagination } = {
      crewTickets: result.tickets.map(withTicketPdfAccess),
    };
    if (result.pagination) {
      payload.pagination = result.pagination;
    }
    return res.json(payload);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching crew tickets:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

/** GET /crew-ticket/spends — pre-aggregated flight spend analytics for the Report Spends tab. */
export async function getCrewTicketReportSpends(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { project_id: projectId } = req.query as { project_id?: string };

    if (projectId && !(await projectOwnedByCaller(projectId, userId, role))) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const scopeFilter = await buildCrewTicketReportSpendsScopeFilter({
      userId,
      isSuperAdmin: isSuperAdmin(role),
      projectId,
    });
    if (!scopeFilter) {
      const reportSpends = buildReportSpendsFromTickets([], { projectId });
      return res.json({ reportSpends });
    }

    const tickets = await findCrewTicketRowsForReportSpends(scopeFilter);
    const reportSpends = buildReportSpendsFromTickets(tickets, { projectId });

    return res.json({ reportSpends });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching crew ticket report spends:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function getCrewTicketsByCrewId(
  req: AuthenticatedRequest & Request<{ id: string }>,
  res: Response
) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const crewId = req.params.id;
    if (role === "crew" && crewId !== userId) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }
    if (role === "admin") {
      const crewAllowed = await crewOwnedByCaller(crewId, userId, role);
      if (!crewAllowed) {
        return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
      }
    }

    const allTickets = await findCrewTicketsByCrewId(crewId);
    const tickets =
      role === "admin"
        ? (
            await Promise.all(
              allTickets.map(async (ticket) => {
                const projectId =
                  typeof ticket.project_id === "object" &&
                  ticket.project_id &&
                  "_id" in (ticket.project_id as object)
                    ? (ticket.project_id as { _id: { toString: () => string } })._id.toString()
                    : String(ticket.project_id);
                const allowed = await projectOwnedByCaller(projectId, userId, role);
                return allowed ? ticket : null;
              })
            )
          ).filter((t): t is NonNullable<typeof t> => t != null)
        : allTickets;

    return res.json({ crewTickets: tickets.map(withTicketPdfAccess) });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching crew tickets:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function getCrewTicketById(
  req: AuthenticatedRequest & Request<{ id: string }>,
  res: Response
) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { id } = req.params;
    const allowed = await ticketAccessibleByCaller(id, userId, role);
    if (!allowed) {
      const ticket = await findCrewTicketById(id);
      if (!ticket) {
        return res.status(404).json({ message: "Crew ticket not found." });
      }
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const ticket = await findCrewTicketById(id);
    if (!ticket) {
      return res.status(404).json({ message: "Crew ticket not found." });
    }
    return res.json({ crewTicket: withTicketPdfAccess(ticket) });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching crew ticket:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function postCrewTicket(req: AuthenticatedRequest, res: Response) {
  try {
    const actorUserId = req.user?.userId;
    const role = req.user?.role;
    if (!actorUserId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const body = req.body as {
      crew_id: string;
      project_id: string;
      rig_id?: string;
      from: { Name: string; COUNTRY: string; COUNTRYNAME: string };
      to: { Name: string; COUNTRY: string; COUNTRYNAME: string };
      class: string;
      adult: number;
      children?: number;
      infants?: number;
      trip: string;
      price?: number;
      cashback?: number;
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
    if (!projectOwnedByProject(project, actorUserId, role)) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }
    if (!(await crewOwnedByCaller(body.crew_id, actorUserId, role))) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }
    if (!crew) {
      return res.status(404).json({ message: "Crew not found." });
    }

    const rigResolved = await resolveOptionalRigAttachment(body.rig_id, actorUserId, role);
    if (!rigResolved.ok) {
      return res.status(rigResolved.status).json({ message: rigResolved.message });
    }

    const ticket = await createCrewTicket({
      crew_id: new mongoose.Types.ObjectId(body.crew_id),
      project_id: new mongoose.Types.ObjectId(body.project_id),
      ...(rigResolved.rigObjectId ? { rig_id: rigResolved.rigObjectId } : {}),
      from: body.from,
      to: body.to,
      class: body.class as import("../models/crewTicket.model").CabinClass,
      adult: body.adult,
      children: body.children ?? 0,
      infants: body.infants ?? 0,
      trip: body.trip as import("../models/crewTicket.model").TripType,
      status: CrewTicketStatus.Unapproved,
      markup: 0,
      balance: 0,
      price: body.price ?? 0,
      cashback: body.cashback ?? 0,
    });

    return res.status(201).json({
      message: "Crew ticket created successfully.",
      crewTicket: withTicketPdfAccess(ticket),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error creating crew ticket:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function uploadTicketPdf(
  req: AuthenticatedRequest & Request<{ id: string }> & { uploadedPdfUrl?: string },
  res: Response
) {
  try {
    const actorUserId = req.user?.userId;
    const role = req.user?.role;
    if (!actorUserId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { id } = req.params;
    const allowed = await ticketAccessibleByCaller(id, actorUserId, role);
    if (!allowed) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const pdfUrl = req.uploadedPdfUrl;
    if (!pdfUrl) {
      return res.status(400).json({ message: "PDF upload failed or no file provided." });
    }
    const ticket = await updateCrewTicketPdfUrl(id, pdfUrl);
    if (!ticket) {
      return res.status(404).json({ message: "Crew ticket not found." });
    }
    return res.status(200).json({
      message: "Ticket PDF uploaded successfully.",
      crewTicket: withTicketPdfAccess(ticket),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error uploading ticket PDF:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function patchCrewTicket(req: AuthenticatedRequest & Request<{ id: string }>, res: Response) {
  try {
    const actorUserId = req.user?.userId;
    const role = req.user?.role;
    if (!actorUserId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { id } = req.params;
    const allowed = await ticketAccessibleByCaller(id, actorUserId, role);
    if (!allowed) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const body = req.body as Partial<{
      from: { Name: string; COUNTRY: string; COUNTRYNAME: string };
      to: { Name: string; COUNTRY: string; COUNTRYNAME: string };
      class: CabinClass;
      adult: number;
      children: number;
      infants: number;
      trip: TripType;
      price: number;
      cashback: number;
      rig_id: string;
    }>;

    const updateData: Partial<Omit<import("../models/crewTicket.model").CrewTicket, "id" | "crew_id" | "project_id">> =
      {};

    if (body.rig_id !== undefined) {
      const rigResolved = await resolveOptionalRigAttachment(body.rig_id, actorUserId, role);
      if (!rigResolved.ok) {
        return res.status(rigResolved.status).json({ message: rigResolved.message });
      }
      if (rigResolved.rigObjectId) {
        updateData.rig_id = rigResolved.rigObjectId;
      }
      // Omit rig_id update if resolver returned undefined — cannot clear rig via PATCH in minimal scope
    }

    if (body.from !== undefined) updateData.from = body.from;
    if (body.to !== undefined) updateData.to = body.to;
    if (body.class !== undefined) updateData.class = body.class;
    if (body.adult !== undefined) updateData.adult = body.adult;
    if (body.children !== undefined) updateData.children = body.children;
    if (body.infants !== undefined) updateData.infants = body.infants;
    if (body.trip !== undefined) updateData.trip = body.trip;
    if (body.price !== undefined) updateData.price = body.price;
    if (body.cashback !== undefined) updateData.cashback = body.cashback;

    const ticket = await updateCrewTicket(id, updateData);
    if (!ticket) {
      return res.status(404).json({ message: "Crew ticket not found." });
    }
    return res.json({
      message: "Crew ticket updated successfully.",
      crewTicket: withTicketPdfAccess(ticket),
    });
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

/** Outbound start and final arrival from search/book flight legs. */
function parseTravelBoundsFromBookFlight(legs: unknown): { travelStart: Date; travelEnd: Date } | null {
  if (!Array.isArray(legs) || legs.length === 0) return null;
  const first = legs[0] as {
    departureTime?: string;
    arrivalTime?: string;
    itinerary?: Array<{ departureTime?: string; arrivalTime?: string }>;
  };
  const last = legs[legs.length - 1] as typeof first;
  const firstItin = first?.itinerary?.[0];
  const lastItinArr = last?.itinerary;
  const lastItin =
    lastItinArr && lastItinArr.length > 0 ? lastItinArr[lastItinArr.length - 1] : undefined;
  const depStr =
    first?.departureTime || firstItin?.departureTime || "";
  const arrStr = last?.arrivalTime || lastItin?.arrivalTime || "";
  const travelStart = depStr ? new Date(depStr) : null;
  const travelEnd = arrStr ? new Date(arrStr) : null;
  if (
    !travelStart ||
    !travelEnd ||
    Number.isNaN(travelStart.getTime()) ||
    Number.isNaN(travelEnd.getTime())
  ) {
    return null;
  }
  return { travelStart, travelEnd };
}

export async function bookFlight(req: AuthenticatedRequest, res: Response) {
  try {
    const actorUserId = req.user?.userId;
    const role = req.user?.role;
    if (!actorUserId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const body = req.body as {
      project_id?: string;
      crew_ids?: string[];
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
      cashback?: number;
      price?: number;
      /** Currency of price, cashback (e.g. from search). Default GBP. */
      currency?: string;
    };

    const crewIdsArray = Array.isArray(body.crew_ids) ? body.crew_ids : [];

    if (body.project_id != null && body.project_id !== "") {
      if (!mongoose.Types.ObjectId.isValid(body.project_id)) {
        return res.status(400).json({ message: "Invalid project_id." });
      }
    }

    if (crewIdsArray.length > 0 && new Set(crewIdsArray).size !== crewIdsArray.length) {
      return res.status(400).json({ message: "crew_ids must not contain duplicate values." });
    }

    let project: Awaited<ReturnType<typeof findProjectById>> = null;
    if (body.project_id) {
      project = await findProjectById(body.project_id);
      if (!project) {
        return res.status(404).json({ message: "Project not found." });
      }
      if (!projectOwnedByProject(project, actorUserId, role)) {
        return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
      }
    }

    for (const crewId of crewIdsArray) {
      if (!(await crewOwnedByCaller(crewId, actorUserId, role))) {
        return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
      }
    }

    const projectRigId = project ? projectRigObjectId(project) : undefined;

    const adminId = project
      ? (() => {
          const admin = project.createdBy;
          return typeof admin === "object" && admin && "id" in admin
            ? (admin as { id: string }).id
            : null;
        })()
      : actorUserId;

    const fl = body.flight;
    const flightId = fl.id;
    const firstLeg = fl.legs[0];
    const firstItin = firstLeg?.itinerary?.[0];
    const from = parseAirportFromString(firstItin?.fromAirport || "");

    /** Combined outbound+return from search uses id prefix `rt-`; do not infer RT from connection segment count. */
    const isRoundTripBundle =
      typeof flightId === "string" && flightId.startsWith("rt-");
    let toAirportRaw = "";
    if (isRoundTripBundle && firstLeg?.itinerary?.length) {
      const outLast = firstLeg.itinerary[firstLeg.itinerary.length - 1];
      toAirportRaw = outLast?.toAirport ?? "";
    } else {
      const lastLeg = fl.legs[fl.legs.length - 1];
      const lastItins = lastLeg?.itinerary ?? [];
      const lastItin = lastItins[lastItins.length - 1];
      toAirportRaw = lastItin?.toAirport ?? firstItin?.toAirport ?? "";
    }
    const to = parseAirportFromString(toAirportRaw);
    const cabinClass = cabinToClass(fl.fares?.[0]?.cabin || "");
    const legCount = fl.legs?.length ?? 1;
    const trip = isRoundTripBundle ? TripType.RoundTrip : TripType.OneWay;
    const travelBounds = parseTravelBoundsFromBookFlight(fl.legs ?? []);
    const adult = body.adult ?? 1;
    const children = body.children ?? 0;
    const infants = body.infants ?? 0;

    if (!from.Name || !to.Name) {
      return res.status(400).json({
        message:
          "Could not extract from/to from flight legs/itinerary (fromAirport, toAirport).",
      });
    }

    const requestCurrency = (body.currency ?? "GBP") as CurrencyCode;

    const [adminSettings, superAdmin] = await Promise.all([
      getAdminSettings(),
      findFirstSuperAdmin(),
    ]);

    const baseMarkupGBP = superAdmin?.markup ?? adminSettings.pricing.flatMarkup ?? 0;
    const markupGBP =
      Math.round(baseMarkupGBP * legCount * 100) / 100;

    let rates: ExchangeRates;
    try {
      rates = await fetchRates();
    } catch (currencyErr) {
      console.error("Currency fetch error:", currencyErr);
      return res.status(500).json({ message: "Could not fetch currency rates." });
    }

    const payloadCashbackRaw = body.cashback ?? 0;
    const payloadPriceRaw =
      body.price ??
      (fl as { fares?: Array<{ price?: number; totalFare?: number }> }).fares?.[0]?.price ??
      (fl as { fares?: Array<{ price?: number; totalFare?: number }> }).fares?.[0]?.totalFare ??
      0;
    const cashbackGBP = Math.round(convert(payloadCashbackRaw, requestCurrency, "GBP", rates) * 100) / 100;
    const priceGBP = Math.round(convert(payloadPriceRaw, requestCurrency, "GBP", rates) * 100) / 100;

    const invalidCrewIds: string[] = [];
    const missingCrewIds: string[] = [];

    for (const crewId of crewIdsArray) {
      if (!mongoose.Types.ObjectId.isValid(crewId)) {
        invalidCrewIds.push(crewId);
        continue;
      }
      const crew = await findCrewByCrewId(crewId);
      if (!crew) {
        missingCrewIds.push(crewId);
      }
    }

    if (invalidCrewIds.length > 0) {
      return res.status(400).json({
        message: "Invalid crew_id(s).",
        crew_ids: invalidCrewIds,
      });
    }
    if (missingCrewIds.length > 0) {
      return res.status(404).json({
        message: "Crew not found for one or more crew_id(s).",
        crew_ids: missingCrewIds,
      });
    }

    const created: import("../models/crewTicket.model").CrewTicket[] = [];
    let runningBalance = body.project_id ? await sumMarkupByProject(body.project_id) : 0;
    const flightSnapshot = buildFlightSnapshotFromBookPayload(
      fl,
      requestCurrency,
      payloadPriceRaw
    );

    const ticketTargets =
      crewIdsArray.length > 0 ? crewIdsArray.map((crewId) => ({ crewId })) : [{ crewId: undefined }];

    for (const { crewId } of ticketTargets) {
      runningBalance += markupGBP;

      const ticket = await createCrewTicket({
        ...(crewId ? { crew_id: new mongoose.Types.ObjectId(crewId) } : {}),
        ...(body.project_id ? { project_id: new mongoose.Types.ObjectId(body.project_id) } : {}),
        ...(!body.project_id ? { createdBy: new mongoose.Types.ObjectId(actorUserId) } : {}),
        ...(projectRigId ? { rig_id: projectRigId } : {}),
        from,
        to,
        class: cabinClass,
        adult,
        children,
        infants,
        trip,
        status: CrewTicketStatus.Unapproved,
        markup: markupGBP,
        balance: runningBalance,
        price: priceGBP,
        cashback: cashbackGBP,
        ...(travelBounds
          ? { travelStart: travelBounds.travelStart, travelEnd: travelBounds.travelEnd }
          : {}),
        flightSnapshot,
      });
      created.push(ticket);
    }

    // Update admin balance (markup) and reduce cancellation debt (installment matches search surcharge in payload price)
    if (adminId && created.length > 0) {
      const adminDoc = await findAdminById(adminId);
      const currentBalance = adminDoc?.balance ?? 0;
      const totalMarkupGBP = markupGBP * created.length;
      await updateAdminBalance(adminId, currentBalance + totalMarkupGBP);

      const o = adminDoc?.cancellationOutstanding ?? 0;
      const s = adminDoc?.cancellationSlotsRemaining ?? 0;
      const billingUnits = created.length * legCount;
      const { newOutstanding, newSlots } = applyCancellationPaymentOnBook(o, s, billingUnits);
      await updateAdminCancellationState(adminId, newOutstanding, newSlots);
    }

    await Promise.all(
      created.map(async (ticket) => {
        const crewId = ticket.crew_id ? refId(ticket.crew_id) : null;
        const crew = crewId ? await findCrewByCrewId(crewId) : null;
        const { flight: flightData } = buildFlightTicketDataFromCrewTicket(ticket);
        await sendTicketApprovalRequestEmail({
          ticketId: ticket.id,
          crewName: crewDisplayName(crew ?? ticket.crew_id),
          crewEmail: crew?.email,
          crewPhone: crew?.phone,
          projectTitle: projectDisplayTitle(ticket.project_id) || project?.title || "Unassigned",
          vesselName: vesselDisplayName(ticket),
          flight: flightData,
          passportNumber: crew?.passport?.passport_number,
          passportDocumentUrl: crew?.passport?.passport_document,
        });
      })
    );

    const crewLabel =
      crewIdsArray.length > 0
        ? ` for ${created.length} crew member${created.length === 1 ? "" : "s"}`
        : "";
    return res.status(201).json({
      message: `Crew ticket(s) created successfully${crewLabel} and sent for approval.`,
      crewTickets: created.map(withTicketPdfAccess),
      flightId,
    });
  } catch (error) {
    console.error("Error booking flight:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function approveCrewTicket(
  req: AuthenticatedRequest & Request<{ id: string }>,
  res: Response
) {
  try {
    const actorUserId = req.user?.userId;
    const role = req.user?.role;
    if (!actorUserId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }
    if (!isSuperAdmin(role)) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const { id } = req.params;
    const { bookingReference } = req.body as { bookingReference: string };
    const trimmedReference = bookingReference.trim();
    const ticket = await findCrewTicketById(id);
    if (!ticket) {
      return res.status(404).json({ message: "Crew ticket not found." });
    }
    if (ticket.status === CrewTicketStatus.Approved) {
      return res.status(409).json({ message: "Crew ticket is already approved." });
    }

    const crewId = refId(ticket.crew_id);
    const crew = await findCrewByCrewId(crewId);
    if (!crew) {
      return res.status(404).json({ message: "Crew not found." });
    }

    const approvedTicket = await updateCrewTicket(id, {
      status: CrewTicketStatus.Approved,
      bookingReference: trimmedReference,
      approvedAt: new Date(),
      approvedBy: new mongoose.Types.ObjectId(actorUserId),
    });

    if (!approvedTicket) {
      return res.status(404).json({ message: "Crew ticket not found." });
    }

    const { flight: flightData } = buildFlightTicketDataFromCrewTicket(approvedTicket);
    let ticketWithPdf = approvedTicket;
    try {
      await generateAndUploadTicketPdf({
        ticketId: approvedTicket.id,
        crewFirstname: crew.firstname,
        flight: flightData,
        renderOptions: {
          bookingReference: trimmedReference,
          passengerName: crewDisplayName(crew),
          vesselName: vesselDisplayName(approvedTicket),
        },
      });
      const refreshed = await findCrewTicketById(id);
      if (refreshed) {
        ticketWithPdf = refreshed;
      }
    } catch (pdfError) {
      // eslint-disable-next-line no-console
      console.error("Failed to generate ticket PDF on approval:", pdfError);
    }

    return res.status(200).json({
      message: "Crew ticket approved successfully.",
      crewTicket: withTicketPdfAccess(ticketWithPdf),
      pdfDownloadUrl: `/crew-ticket/${ticketWithPdf.id}/pdf`,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error approving crew ticket:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function downloadCrewTicketPdf(
  req: AuthenticatedRequest & Request<{ id: string }>,
  res: Response
) {
  try {
    const actorUserId = req.user?.userId;
    const role = req.user?.role;
    if (!actorUserId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { id } = req.params;
    const allowed = await ticketAccessibleByCaller(id, actorUserId, role);
    if (!allowed) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const ticket = await findCrewTicketById(id);
    if (!ticket) {
      return res.status(404).json({ message: "Crew ticket not found." });
    }
    if (ticket.status !== CrewTicketStatus.Approved) {
      return res.status(403).json({ message: "Ticket PDF is available only after approval." });
    }
    if (!ticket.pdf && !ticket.bookingReference) {
      return res.status(400).json({
        message: "Ticket is missing a booking reference and has no uploaded PDF.",
      });
    }

    const crewId = refId(ticket.crew_id);
    const crew = await findCrewByCrewId(crewId);
    if (!crew) {
      return res.status(404).json({ message: "Crew not found." });
    }

    const { flight: flightData } = buildFlightTicketDataFromCrewTicket(ticket);
    const { buffer: pdfBuffer } = await resolveCrewTicketPdfBuffer({
      storedPdfUrl: ticket.pdf,
      persistTicketId: ticket.id,
      generate: {
        crewFirstname: crew.firstname,
        flight: flightData,
        renderOptions: {
          bookingReference: ticket.bookingReference,
          passengerName: crewDisplayName(crew),
          vesselName: vesselDisplayName(ticket),
        },
      },
    });

    const filename = `crew-ticket-${ticket.bookingReference}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error downloading crew ticket PDF:", error);
    return res.status(500).json({ message: "Failed to load ticket PDF." });
  }
}

export async function sendTicketToCrewEmail(
  req: AuthenticatedRequest & Request<{ id: string }>,
  res: Response
) {
  try {
    const actorUserId = req.user?.userId;
    const role = req.user?.role;
    if (!actorUserId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { id } = req.params;
    const allowed = await ticketAccessibleByCaller(id, actorUserId, role);
    if (!allowed) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const ticket = await findCrewTicketById(id);
    if (!ticket) {
      return res.status(404).json({ message: "Crew ticket not found." });
    }

    const crewId =
      typeof ticket.crew_id === "object" &&
      ticket.crew_id &&
      "_id" in (ticket.crew_id as object)
        ? ((ticket.crew_id as { _id: { toString: () => string } })._id.toString() as string)
        : String(ticket.crew_id);
    const crew = await findCrewByCrewId(crewId);
    if (!crew) {
      return res.status(404).json({ message: "Crew not found." });
    }

    // Ticket sending to crew temporarily disabled.
    // const { flight: flightData } = buildFlightTicketDataFromCrewTicket(ticket);
    // const signedPdfUrl = ticket.pdf ? getSignedCloudinaryDeliveryUrl(ticket.pdf) ?? undefined : undefined;
    // await sendFlightTicketEmail(
    //   crew.email,
    //   crew.firstname,
    //   flightData,
    //   signedPdfUrl,
    //   {
    //     bookingReference: ticket.bookingReference,
    //     passengerName: crewDisplayName(crew),
    //     vesselName: vesselDisplayName(ticket),
    //   }
    // );

    return res.status(503).json({
      message: "Ticket sending to crew is temporarily disabled.",
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error sending ticket to crew email:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function deleteCrewTicketHandler(
  req: AuthenticatedRequest & Request<{ id: string }>,
  res: Response
) {
  try {
    const actorUserId = req.user?.userId;
    const role = req.user?.role;
    if (!actorUserId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { id } = req.params;
    const allowed = await ticketAccessibleByCaller(id, actorUserId, role);
    if (!allowed) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const ticket = await findCrewTicketById(id);
    if (!ticket) {
      return res.status(404).json({ message: "Crew ticket not found." });
    }
    const { feeGbp, adminId } = await accrueCancellationDebtForDeletedCrewTicket(ticket);
    const deleted = await deleteCrewTicket(id);
    if (!deleted) {
      if (adminId && feeGbp > 0) {
        await revertCancellationAccrual(adminId, feeGbp);
      }
      return res.status(404).json({ message: "Crew ticket not found." });
    }
    return res.json({ message: "Crew ticket deleted successfully." });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error deleting crew ticket:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

/** Delete crew ticket by crew_id and ticket_id - superadmin only. Validates ticket belongs to crew. */
export async function deleteCrewTicketByCrewHandler(
  req: import("express").Request<{ crew_id: string; ticket_id: string }>,
  res: Response
) {
  try {
    const { crew_id, ticket_id } = req.params;
    const ticket = await findCrewTicketById(ticket_id);
    if (!ticket) {
      return res.status(404).json({ message: "Crew ticket not found." });
    }
    const ticketCrewId =
      typeof ticket.crew_id === "object" && ticket.crew_id && "_id" in (ticket.crew_id as object)
        ? (ticket.crew_id as { _id: { toString: () => string } })._id.toString()
        : String(ticket.crew_id);
    if (ticketCrewId !== crew_id) {
      return res.status(403).json({ message: "Ticket does not belong to this crew member." });
    }
    const { feeGbp, adminId } = await accrueCancellationDebtForDeletedCrewTicket(ticket);
    const deleted = await deleteCrewTicket(ticket_id);
    if (!deleted) {
      if (adminId && feeGbp > 0) {
        await revertCancellationAccrual(adminId, feeGbp);
      }
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
      const isMarineFare = simplifiedFares.some((fare: any) => fare.indicator === "M");

      return {
        id: `${firstSegment.Trackid || "flight"}-${index}-${firstSegment.DepartureDateTime.replace(/[:T-]/g, "")}`,
        legs: legs.filter(Boolean),
        fares: simplifiedFares,
        isMarineFare,
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

type FlightSortBy = "price" | "duration" | "stops" | "departureTime" | "arrivalTime";
type FlightSortOrder = "asc" | "desc";

function durationToMinutes(duration: unknown): number | null {
  if (typeof duration !== "string") return null;

  const hoursMatch = duration.match(/(\d+)\s*h/i);
  const minutesMatch = duration.match(/(\d+)\s*m/i);
  const hours = hoursMatch ? Number(hoursMatch[1]) : 0;
  const minutes = minutesMatch ? Number(minutesMatch[1]) : 0;

  if (!hoursMatch && !minutesMatch) return null;
  return hours * 60 + minutes;
}

function formatDurationMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** Outbound/inbound summary for a single direction (initial or return leg). */
function summarizeFlightDirection(legs: unknown[], directionStops?: number) {
  const legArr = Array.isArray(legs) ? legs : [];
  if (!legArr.length) {
    return {
      departureTime: undefined,
      arrivalTime: undefined,
      from: undefined,
      to: undefined,
      duration: undefined,
      stops: directionStops ?? 0,
      legs: [] as unknown[],
      airlineName: undefined,
      airlineCode: undefined,
    };
  }

  const first = legArr[0] as Record<string, unknown>;
  const last = legArr[legArr.length - 1] as Record<string, unknown>;
  const durationMinutes = legArr.reduce((sum: number, leg) => {
    const minutes = durationToMinutes((leg as Record<string, unknown>)?.duration);
    return minutes == null ? sum : sum + minutes;
  }, 0);

  return {
    departureTime: first?.departureTime as string | undefined,
    arrivalTime: last?.arrivalTime as string | undefined,
    from: first?.from as string | undefined,
    to: last?.to as string | undefined,
    duration:
      durationMinutes > 0
        ? formatDurationMinutes(durationMinutes)
        : (first?.duration as string | undefined),
    stops:
      directionStops ??
      Math.max(...legArr.map((leg) => Number((leg as Record<string, unknown>)?.stops) || 0)),
    legs: legArr,
    airlineName: first?.airlineName as string | undefined,
    airlineCode: first?.airlineCode as string | undefined,
  };
}

function combineRoundTripFlights(outboundFlight: any, inboundFlight: any, outboundRaw: any, inboundRaw: any) {
  const outbound = summarizeFlightDirection(outboundFlight.legs, outboundFlight.stops);
  const inbound = summarizeFlightDirection(inboundFlight.legs, inboundFlight.stops);

  return {
    id: `rt-${outboundFlight.id}-${inboundFlight.id}`,
    tripType: "round-trip" as const,
    outbound,
    inbound,
    /** Whole-trip bounds: outbound departure through return arrival. */
    departureTime: outbound.departureTime,
    arrivalTime: inbound.arrivalTime,
    /** Flat legs for POST /book compatibility. */
    legs: [...outbound.legs, ...inbound.legs],
    fares: outboundFlight.fares.map((fare: any, fareIdx: number) => {
      const inboundFare = inboundFlight.fares[fareIdx] ?? inboundFlight.fares[0];
      return {
        ...fare,
        price: (fare.price ?? 0) + (inboundFare.price ?? 0),
        markup: (fare.markup ?? 0) + (inboundFare.markup ?? 0),
        percentageMarkup: (fare.percentageMarkup ?? 0) + (inboundFare.percentageMarkup ?? 0),
        totalFare: fare.totalFare + inboundFare.totalFare,
        basicFare: fare.basicFare + inboundFare.basicFare,
        cancellationSurcharge:
          (fare.cancellationSurcharge ?? 0) + (inboundFare.cancellationSurcharge ?? 0),
      };
    }),
    fareBreakdown: {
      total: outboundRaw.fareBreakdown.total + inboundRaw.fareBreakdown.total,
      base: outboundRaw.fareBreakdown.base + inboundRaw.fareBreakdown.base,
      tax: outboundRaw.fareBreakdown.tax + inboundRaw.fareBreakdown.tax,
      serviceFee: outboundRaw.fareBreakdown.serviceFee + inboundRaw.fareBreakdown.serviceFee,
      gst: outboundRaw.fareBreakdown.gst + inboundRaw.fareBreakdown.gst,
    },
    airlineName: outbound.airlineName,
    airlineCode: outbound.airlineCode,
    stops: (outboundFlight.stops ?? 0) + (inboundFlight.stops ?? 0),
    isMarineFare: isMarineFlight(outboundFlight) || isMarineFlight(inboundFlight),
    cashback: outboundFlight.cashback ?? inboundFlight.cashback ?? null,
    appliedIncentive: outboundFlight.appliedIncentive ?? inboundFlight.appliedIncentive ?? null,
    originalCurrency: outboundFlight.originalCurrency ?? inboundFlight.originalCurrency,
  };
}

function dateTimeToMs(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function flightDurationMinutes(flight: any): number | null {
  if (flight?.tripType === "round-trip" && flight.outbound?.legs && flight.inbound?.legs) {
    const outboundMinutes = flightDurationMinutes({ legs: flight.outbound.legs });
    const inboundMinutes = flightDurationMinutes({ legs: flight.inbound.legs });
    if (outboundMinutes != null && inboundMinutes != null) {
      return outboundMinutes + inboundMinutes;
    }
  }

  const legs = Array.isArray(flight?.legs) ? flight.legs : [];
  if (legs.length === 0) return null;

  const durationSum = legs.reduce((sum: number, leg: any) => {
    const minutes = durationToMinutes(leg?.duration);
    return minutes == null ? sum : sum + minutes;
  }, 0);

  if (durationSum > 0) return durationSum;

  const firstDeparture = dateTimeToMs(legs[0]?.departureTime);
  const lastArrival = dateTimeToMs(legs[legs.length - 1]?.arrivalTime);
  if (firstDeparture == null || lastArrival == null) return null;

  return Math.max(0, Math.round((lastArrival - firstDeparture) / (1000 * 60)));
}

function flightSortValue(flight: any, sortBy: FlightSortBy): number | null {
  const legs = Array.isArray(flight?.legs) ? flight.legs : [];
  switch (sortBy) {
    case "price": {
      const fares = Array.isArray(flight?.fares) ? flight.fares : [];
      const prices = fares
        .map((fare: any) => Number(fare?.price ?? fare?.totalFare))
        .filter((price: number) => Number.isFinite(price));
      return prices.length > 0 ? Math.min(...prices) : null;
    }
    case "duration":
      return flightDurationMinutes(flight);
    case "stops":
      return Number.isFinite(Number(flight?.stops)) ? Number(flight.stops) : null;
    case "departureTime":
      return dateTimeToMs(flight?.outbound?.departureTime ?? legs[0]?.departureTime);
    case "arrivalTime":
      return dateTimeToMs(
        flight?.inbound?.arrivalTime ?? legs[legs.length - 1]?.arrivalTime
      );
    default:
      return null;
  }
}

function isMarineFlight(flight: any): boolean {
  if (flight?.isMarineFare === true) return true;
  const fares = Array.isArray(flight?.fares) ? flight.fares : [];
  return fares.some((fare: any) => {
    const indicator = String(fare?.indicator || "").toUpperCase();
    const type = String(fare?.type || "").toUpperCase();
    const name = String(fare?.name || "").toUpperCase();
    return indicator === "M" || type === "MARINE" || name.includes("MARINE");
  });
}

function sortFlights(flights: any[], sortBy?: FlightSortBy, sortOrder: FlightSortOrder = "asc") {
  const direction = sortOrder === "desc" ? -1 : 1;
  return flights
    .map((flight, index) => ({
      flight,
      index,
      value: sortBy ? flightSortValue(flight, sortBy) : null,
      isMarine: isMarineFlight(flight),
    }))
    .sort((a, b) => {
      if (a.isMarine !== b.isMarine) return a.isMarine ? -1 : 1;
      if (!sortBy) return a.index - b.index;
      if (a.value == null && b.value == null) return a.index - b.index;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      const diff = a.value - b.value;
      return diff === 0 ? a.index - b.index : diff * direction;
    })
    .map(({ flight }) => flight);
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
    /** Prefer non-stop only (Riya chkNonStop). Useful for multi-city per-leg searches. */
    directOnly?: boolean;
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
    chkNonStop: Boolean(opts.directOnly),
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

export async function searchFlightsController(req: AuthenticatedRequest, res: Response) {
  try {
    const actorUserId = req.user?.userId;
    const role = req.user?.role;
    if (!actorUserId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

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
      sortBy,
      sortOrder = "asc",
      departureTime: filterDepartureTime,
      departureTimeMode = "after",
      arrivalDate: filterArrivalDate,
      arrivalTime: filterArrivalTime,
      arrivalTimeMode = "before",
      returnTime: filterReturnTime,
      returnTimeMode = "after",
      /** When true, Riya search requests non-stop flights only for this segment. */
      directOnly = false,
    } = body;

    const crewIdsArray = Array.isArray(crew_ids) ? crew_ids : [];

    if (project_id) {
      const projectAllowed = await projectOwnedByCaller(String(project_id), actorUserId, role);
      if (!projectAllowed) {
        return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
      }
    }
    for (const crewId of crewIdsArray) {
      if (!(await crewOwnedByCaller(String(crewId), actorUserId, role))) {
        return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
      }
    }

    const [adminSettings, superAdmin] = await Promise.all([
      getAdminSettings(),
      findFirstSuperAdmin(),
    ]);

    const superAdminCashback = superAdmin?.cashback ?? null;

    const adminIdForDebt = actorUserId;
    const adminForDebt = adminIdForDebt ? await findAdminById(adminIdForDebt) : null;
    const installmentGbpForSearch = cancellationInstallmentGbp(
      adminForDebt?.cancellationOutstanding ?? 0,
      adminForDebt?.cancellationSlotsRemaining ?? 0
    );

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
      const localCancellationSurcharge = cancellationInstallmentInCurrency(
        installmentGbpForSearch,
        requestedCurrency,
        rates
      );
      const superAdminMarkupRaw = superAdmin?.markup ?? adminSettings.pricing.flatMarkup ?? 0;
      const markupPercentageRaw =
        superAdmin?.markupPercentage ?? adminSettings.pricing.percentageMarkup ?? 0;
      const localSuperAdminMarkup = convert(
        superAdminMarkupRaw,
        baseCurrency as CurrencyCode,
        requestedCurrency,
        rates
      );
      const localFlatCashback = superAdminCashback != null
        ? convert(superAdminCashback, baseCurrency as CurrencyCode, requestedCurrency, rates)
        : convert(adminSettings.incentives.flatCashback || 0, baseCurrency as CurrencyCode, requestedCurrency, rates);

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
          const riyaPriceConverted = convert(fare.totalFare, originalCurrency, requestedCurrency, rates);
          const flatMarkup = localSuperAdminMarkup;
          const percentageBase = riyaPriceConverted + flatMarkup;
          const percentageMarkupAmount =
            markupPercentageRaw > 0 ? (percentageBase * markupPercentageRaw) / 100 : 0;
          const price = Math.round(
            Math.max(
              0,
              riyaPriceConverted + flatMarkup + percentageMarkupAmount + localCancellationSurcharge
            )
          );
          const markup = Math.round(flatMarkup);
          return {
            ...fare,
            price,
            markup,
            percentageMarkup: Math.round(percentageMarkupAmount),
            totalFare: price,
            cancellationSurcharge: Math.round(localCancellationSurcharge),
          };
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

    const emptyRiyaDate = "0001-01-01T00:00:00";
    const formatRiyaDate = (date?: string) => (date ? `${date}T00:00:00` : emptyRiyaDate);
    const shiftDate = (date: string, days: number) => {
      const parsedDate = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(parsedDate.getTime())) return date;
      parsedDate.setUTCDate(parsedDate.getUTCDate() + days);
      return parsedDate.toISOString().slice(0, 10);
    };
    const departureSearchDates = departureDate
      ? [departureDate]
      : filterArrivalDate
        ? [filterArrivalDate, shiftDate(filterArrivalDate, -1), shiftDate(filterArrivalDate, -2)]
        : [];

    const formattedDepDate = formatRiyaDate(departureSearchDates[0]);
    const formattedReturnDate =
      tripType === "round-trip" && returnDate ? formatRiyaDate(returnDate) : emptyRiyaDate;

    const hasOutboundTimeFilters =
      filterDepartureTime || filterArrivalDate || filterArrivalTime;
    const hasReturnTimeFilters = Boolean(filterReturnTime);

    const parseDateTime = (isoStr: string) => {
      const match = String(isoStr || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
      return match ? { date: match[1], time: `${match[2]}:${match[3]}` } : null;
    };

    type TimeFilterMode = "before" | "after";

    const matchesTimeWithMode = (
      actual: string,
      filter: string,
      mode: TimeFilterMode
    ): boolean => {
      if (mode === "before") return actual <= filter;
      return actual >= filter;
    };

    const matchesOutboundTimeFilters = (flight: any) => {
      if (!hasOutboundTimeFilters) return true;
      const legs = flight?.legs ?? [];
      if (!legs.length) return true;

      const firstLeg = legs[0];
      const lastLeg = legs[legs.length - 1];
      const dep = parseDateTime(firstLeg?.departureTime);
      const arr = parseDateTime(lastLeg?.arrivalTime);
      if (!dep || !arr) return true;

      if (
        filterDepartureTime &&
        !matchesTimeWithMode(dep.time, filterDepartureTime, departureTimeMode)
      ) {
        return false;
      }
      if (filterArrivalDate && arr.date !== filterArrivalDate) return false;
      if (
        filterArrivalTime &&
        !matchesTimeWithMode(arr.time, filterArrivalTime, arrivalTimeMode)
      ) {
        return false;
      }
      return true;
    };

    const matchesReturnTimeFilters = (flight: any) => {
      if (!hasReturnTimeFilters) return true;
      const firstLeg = flight?.legs?.[0];
      if (!firstLeg) return true;

      const dep = parseDateTime(firstLeg.departureTime);
      if (!dep) return true;

      return matchesTimeWithMode(dep.time, filterReturnTime, returnTimeMode);
    };

    const matchesTimeFilters = matchesOutboundTimeFilters;

    const matchesDirectOnly = (flight: any) => {
      if (!directOnly) return true;
      const stops = typeof flight?.stops === "number" ? flight.stops : Number(flight?.stops) || 0;
      return stops === 0;
    };

    const opts = {
      adults,
      children,
      infants,
      cabinClass,
      currency,
      sector,
      directOnly: Boolean(directOnly),
    };

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

      // Apply admin logic to each leg separately, then combine (flat markup per direction)
      const outWithAdmin = applyAdminLogic(outResults);
      const inWithAdmin = applyAdminLogic(inResults);

      const results: any[] = [];
      const minLen = Math.min(outWithAdmin.length, inWithAdmin.length);
      for (let i = 0; i < minLen; i++) {
        const o = outWithAdmin[i];
        const r = inWithAdmin[i];
        const oRaw = outResults[i];
        const rRaw = inResults[i];
        if (!o || !r || !oRaw || !rRaw) continue;
        if (!matchesOutboundTimeFilters(o)) continue;
        if (!matchesReturnTimeFilters(r)) continue;
        if (!matchesDirectOnly(o) || !matchesDirectOnly(r)) continue;

        results.push(combineRoundTripFlights(o, r, oRaw, rRaw));
      }
      const flights = sortFlights(results, sortBy, sortOrder);
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
      const searchDates = departureSearchDates.length > 0 ? departureSearchDates : [undefined];
      const dataSets = await Promise.all(
        searchDates.map((searchDate) =>
          fetchRiya(
            buildPayload(
              fromData.code,
              toData.code,
              fromData.cityWithCode,
              toData.cityWithCode,
              formatRiyaDate(searchDate),
              from?.COUNTRY || "IN",
              to?.COUNTRY || "IN",
              opts
            )
          )
        )
      );
      const transformedData = dataSets.flatMap((data) => transformRiyaResponse(data || {}, fromData.code, toData.code));
      const flights = sortFlights(
        applyAdminLogic(transformedData)
          .filter(matchesTimeFilters)
          .filter(matchesDirectOnly),
        sortBy,
        sortOrder
      );
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

export interface AirportSearchResult {
  Name: string;
  Code: string;
  AirportName?: string;
  CountryCode: string;
  CountryName: string;
  distanceKm?: number;
  nearbyAirports?: AirportSearchResult[];
  /** @deprecated Use CountryCode */
  COUNTRY?: string;
  /** @deprecated Use CountryName */
  COUNTRYNAME?: string;
}

/** Fallback when Riya returns no data (login/session issues) */
const COUNTRY_NAMES: Record<string, string> = {
  IN: "India", US: "United States", GB: "United Kingdom", AE: "United Arab Emirates",
  FR: "France", DE: "Germany", NL: "Netherlands", SG: "Singapore", AU: "Australia",
  CA: "Canada", CN: "China", JP: "Japan", KR: "South Korea", PK: "Pakistan",
  BD: "Bangladesh", LK: "Sri Lanka", NP: "Nepal", MY: "Malaysia", TH: "Thailand",
  ID: "Indonesia", NO: "Norway", ES: "Spain", IT: "Italy", SA: "Saudi Arabia",
};

/** Country name (lowercase) → ISO3166 alpha-2, built lazily */
let countryNameToIsoLookup: Map<string, string> | null = null;

function resolveCountryIsoFromSearchQuery(searchText: string): string | null {
  const trimmed = searchText.trim();
  if (trimmed.length < 2) return null;
  // Two-letter country code typed directly (must be in our supported list)
  if (trimmed.length === 2 && /^[a-z]{2}$/i.test(trimmed)) {
    const code = trimmed.toUpperCase();
    return COUNTRY_NAMES[code] ? code : null;
  }
  if (!countryNameToIsoLookup) {
    const m = new Map<string, string>();
    for (const [iso, name] of Object.entries(COUNTRY_NAMES)) {
      m.set(name.toLowerCase(), iso);
    }
    for (const [name, iso] of Object.entries(COUNTRY_CODE_MAP)) {
      m.set(name.toLowerCase(), iso);
    }
    countryNameToIsoLookup = m;
  }
  return countryNameToIsoLookup.get(trimmed.toLowerCase()) ?? null;
}

const AIRPORTS_BY_COUNTRY_MAX = 600;
const AIRPORTS_BY_COUNTRY_PAGE = 100;
const AIRPORTS_BY_COUNTRY_MAX_PAGES = Math.ceil(AIRPORTS_BY_COUNTRY_MAX / AIRPORTS_BY_COUNTRY_PAGE);

type AirportroutesCountryHit = {
  icao?: string;
  iata?: string;
  name?: string;
  city?: string;
  country?: string;
  country_code?: string;
  scheduled_service?: boolean;
  type?: string;
  _geo?: {
    lat?: number;
    lng?: number;
  };
  lat?: number;
  lon?: number;
};

const NEARBY_AIRPORT_RADIUS_KM = 100;
const NEARBY_AIRPORT_LIMIT = 5;
const NEARBY_PARENT_LIMIT = 5;

/** Riya getcity display name, e.g. "Mumbai [BOM] - Chhatrapati Shivaji..., India" */
function parseRiyaAirportDisplayName(name: string): { city: string; code: string; airportName: string } | null {
  const match = name.trim().match(/^(.+?)\s*\[([A-Z0-9]{3,4})\]\s*-\s*(.+?)\s*,\s*.+$/i);
  if (!match) return null;
  return {
    city: match[1].trim(),
    code: match[2].trim().toUpperCase(),
    airportName: match[3].trim(),
  };
}

function riyaItemToSearchResult(item: RiyaAirportItem): AirportSearchResult {
  const name = (item.Name ?? "").trim();
  let code = (item.Code ?? "").trim().toUpperCase();
  const countryCode = (item.COUNTRY ?? item.CountryCode ?? "").trim().toUpperCase();
  const countryName = item.COUNTRYNAME ?? item.CountryName ?? COUNTRY_NAMES[countryCode] ?? countryCode;

  const parsed = parseRiyaAirportDisplayName(name);
  if (parsed) {
    if (!code) code = parsed.code;
  }

  return {
    Name: name,
    Code: code,
    ...(parsed?.airportName ? { AirportName: parsed.airportName } : {}),
    CountryCode: countryCode,
    CountryName: countryName,
    COUNTRY: countryCode,
    COUNTRYNAME: countryName,
  };
}

/** airportroutes.com blocks many cloud/datacenter IPs (403 on Vercel); probe once per instance. */
let airportroutesAvailable: boolean | null = null;

async function isAirportroutesAvailable(): Promise<boolean> {
  if (airportroutesAvailable !== null) return airportroutesAvailable;
  try {
    const res = await fetch(
      "https://www.airportroutes.com/api/search-airports/?q=BOM&limit=1"
    );
    airportroutesAvailable = res.ok;
  } catch {
    airportroutesAvailable = false;
  }
  return airportroutesAvailable;
}

function dedupeNestedAirportResults(airports: AirportSearchResult[]): AirportSearchResult[] {
  const nestedCodes = new Set<string>();
  return airports.filter((airport) => {
    const code = airport.Code.trim().toUpperCase();
    if (code && nestedCodes.has(code)) return false;
    for (const nearbyAirport of airport.nearbyAirports ?? []) {
      const nearbyCode = nearbyAirport.Code.trim().toUpperCase();
      if (nearbyCode) nestedCodes.add(nearbyCode);
    }
    return true;
  });
}

/** When airportroutes is blocked, attach other Riya hits with haversine distance from a public IATA dataset. */
async function enrichNearbyFromRiyaSiblings(
  airports: AirportSearchResult[]
): Promise<AirportSearchResult[]> {
  const enriched = await Promise.all(
    airports.map(async (airport, index) => {
      if (index >= NEARBY_PARENT_LIMIT) return airport;
      const code = airport.Code.trim().toUpperCase();
      const country = airport.CountryCode.trim().toUpperCase();
      const parentCoords = await getAirportCoordinatesByIata(code);

      const nearbyAirports = (
        await Promise.all(
          airports
            .filter((other) => {
              const otherCode = other.Code.trim().toUpperCase();
              return (
                otherCode &&
                otherCode !== code &&
                other.CountryCode.trim().toUpperCase() === country
              );
            })
            .map(async (other) => {
              const otherCoords = await getAirportCoordinatesByIata(other.Code);
              if (!parentCoords || !otherCoords) return other;
              const distanceKm = Math.round(
                distanceKmBetween(parentCoords, otherCoords)
              );
              if (distanceKm > NEARBY_AIRPORT_RADIUS_KM) return null;
              return { ...other, distanceKm };
            })
        )
      )
        .filter((airport): airport is AirportSearchResult => airport !== null)
        .sort(
          (a, b) => (a.distanceKm ?? Number.MAX_SAFE_INTEGER) - (b.distanceKm ?? Number.MAX_SAFE_INTEGER)
        )
        .slice(0, NEARBY_AIRPORT_LIMIT);

      return nearbyAirports.length > 0 ? { ...airport, nearbyAirports } : airport;
    })
  );
  return dedupeNestedAirportResults(enriched);
}

/** Prefer commercial-ish rows; still include ICAO-only if scheduled at a paved field */
function airportroutesCountryRowSelectable(hit: AirportroutesCountryHit): boolean {
  const iata = (hit.iata ?? "").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(iata)) return true;
  const type = String(hit.type ?? "").toLowerCase();
  if (type === "heliport" || type === "closed" || type === "balloonport" || type === "seaplane_base") return false;
  return hit.scheduled_service === true;
}

function airportroutesCountryRowToSearchResult(hit: AirportroutesCountryHit, countryIso2: string, countryDisplayName: string): AirportSearchResult | null {
  const iata = (hit.iata ?? "").trim().toUpperCase();
  const rawCode =
    /^[A-Z]{3}$/.test(iata) ? iata : (hit.icao ?? "").trim().toUpperCase() || "";
  if (!rawCode) return null;
  const city = ((hit.city ?? "").trim() || "Unknown").replace(/\s+/g, " ").trim();
  const placeName = (hit.name ?? "").trim().replace(/\s+/g, " ").trim() || "(no name)";
  const name = `${city} [${rawCode}] - ${placeName}, ${countryDisplayName}`;
  const code =
    /^[A-Z]{3}$/.test(iata) ? iata : rawCode.slice(0, 4).toUpperCase();

  return {
    Name: name,
    Code: code,
    AirportName: placeName,
    CountryCode: countryIso2,
    CountryName: countryDisplayName,
    COUNTRY: countryIso2,
    COUNTRYNAME: countryDisplayName,
  };
}

function airportroutesHitToSearchResult(hit: AirportroutesCountryHit, distanceKm?: number): AirportSearchResult | null {
  const countryCode = (hit.country_code ?? hit.country ?? "").trim().toUpperCase();
  const countryName = COUNTRY_NAMES[countryCode] ?? countryCode;
  const mapped = airportroutesCountryRowToSearchResult(hit, countryCode, countryName);
  if (!mapped) return null;
  return {
    ...mapped,
    ...(distanceKm == null ? {} : { distanceKm: Math.round(distanceKm) }),
  };
}

function airportCoordinates(hit: AirportroutesCountryHit): { lat: number; lng: number } | null {
  const lat = hit._geo?.lat ?? hit.lat;
  const lng = hit._geo?.lng ?? hit.lon;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return { lat, lng };
}

async function fetchAirportroutesSearchHits(query: string, limit = 10): Promise<AirportroutesCountryHit[]> {
  const res = await fetch(
    `https://www.airportroutes.com/api/search-airports/?q=${encodeURIComponent(query)}&limit=${limit}`
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { hits?: AirportroutesCountryHit[] };
  return data.hits ?? [];
}

async function resolveAirportroutesAirport(airport: AirportSearchResult): Promise<AirportroutesCountryHit | null> {
  const code = airport.Code.trim().toUpperCase();
  const hits = await fetchAirportroutesSearchHits(code || airport.Name, 10);
  const countryCode = airport.CountryCode.trim().toUpperCase();
  const exactCodeHit = code ? hits.find((hit) => {
    const iata = (hit.iata ?? "").trim().toUpperCase();
    const icao = (hit.icao ?? "").trim().toUpperCase();
    const hitCountry = (hit.country_code ?? hit.country ?? "").trim().toUpperCase();
    return (iata === code || icao === code) && (!countryCode || hitCountry === countryCode);
  }) : undefined;
  return exactCodeHit ?? hits.find((hit) => airportCoordinates(hit)) ?? null;
}

async function fetchNearbyAirports(parentHit: AirportroutesCountryHit, parentCode: string): Promise<AirportSearchResult[]> {
  const parentCoordinates = airportCoordinates(parentHit);
  if (!parentCoordinates) return [];

  const res = await fetch(
    `https://www.airportroutes.com/api/geosearch-airports/?lat=${parentCoordinates.lat}&lng=${parentCoordinates.lng}&radius=${NEARBY_AIRPORT_RADIUS_KM}`
  );
  if (!res.ok) return [];

  const parentCodeUpper = parentCode.trim().toUpperCase();
  const data = (await res.json()) as unknown;
  const hits = Array.isArray(data) ? (data as AirportroutesCountryHit[]) : [];
  return hits
    .filter(airportroutesCountryRowSelectable)
    .map((hit) => {
      const coordinates = airportCoordinates(hit);
      if (!coordinates) return null;
      const code = ((hit.iata ?? "").trim().toUpperCase() || (hit.icao ?? "").trim().toUpperCase());
      if (!code || code === parentCodeUpper) return null;
      const distanceKm = distanceKmBetween(parentCoordinates, coordinates);
      return { hit, distanceKm };
    })
    .filter((item): item is { hit: AirportroutesCountryHit; distanceKm: number } => item !== null)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map(({ hit, distanceKm }) => airportroutesHitToSearchResult(hit, distanceKm))
    .filter((airport): airport is AirportSearchResult => airport !== null)
    .slice(0, NEARBY_AIRPORT_LIMIT);
}

async function enrichAirportsWithNearby(airports: AirportSearchResult[]): Promise<AirportSearchResult[]> {
  if (!(await isAirportroutesAvailable())) {
    return enrichNearbyFromRiyaSiblings(airports);
  }

  const enriched = await Promise.all(
    airports.map(async (airport, index) => {
      if (index >= NEARBY_PARENT_LIMIT) return airport;
      try {
        const parentHit = await resolveAirportroutesAirport(airport);
        if (!parentHit) return airport;
        const nearbyAirports = await fetchNearbyAirports(parentHit, airport.Code);
        return {
          ...airport,
          AirportName: airport.AirportName ?? parentHit.name,
          ...(nearbyAirports.length > 0 ? { nearbyAirports } : {}),
        };
      } catch {
        return airport;
      }
    })
  );

  return dedupeNestedAirportResults(enriched);
}

function prioritizeExactAirportMatch(airports: AirportSearchResult[], query: string): AirportSearchResult[] {
  const codeQuery = query.trim().toUpperCase();
  if (!/^[A-Z]{3,4}$/.test(codeQuery)) return airports;
  return [...airports].sort((a, b) => {
    const aExact = a.Code.trim().toUpperCase() === codeQuery ? 0 : 1;
    const bExact = b.Code.trim().toUpperCase() === codeQuery ? 0 : 1;
    return aExact - bExact;
  });
}

/** Paginate AirportRoutes `/countries/{code}/airports/` so typing a country returns its airports/cities */
async function fetchAirportsByCountry(countryIso2: string): Promise<AirportSearchResult[]> {
  const countryDisplayName = COUNTRY_NAMES[countryIso2] ?? countryIso2;
  const out: AirportSearchResult[] = [];
  const dedupeKeys = new Set<string>();
  let page = 1;
  while (out.length < AIRPORTS_BY_COUNTRY_MAX && page <= AIRPORTS_BY_COUNTRY_MAX_PAGES) {
    const url =
      `https://www.airportroutes.com/api/countries/${encodeURIComponent(countryIso2)}/airports/` +
      `?page=${page}&limit=${AIRPORTS_BY_COUNTRY_PAGE}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const data = (await res.json()) as {
      airports?: AirportroutesCountryHit[];
      has_next?: boolean;
    };
    const batch = data.airports ?? [];
    if (batch.length === 0) break;

    for (const hit of batch) {
      if (!airportroutesCountryRowSelectable(hit)) continue;
      const mapped = airportroutesCountryRowToSearchResult(hit, countryIso2, countryDisplayName);
      if (!mapped) continue;
      const iataLen = /^[A-Za-z]{3}$/.test(mapped.Code) ? mapped.Code : "";
      const dk = iataLen.length === 3 ? `i:${iataLen}` : `icao:${hit.icao ?? mapped.Code}:${mapped.Name}`;
      if (dedupeKeys.has(dk)) continue;
      dedupeKeys.add(dk);
      out.push(mapped);
    }

    if (!data.has_next) break;
    page += 1;
  }

  out.sort((a, b) => a.Name.localeCompare(b.Name, undefined, { sensitivity: "base" }));
  return out;
}

async function fetchAirportsFallback(query: string): Promise<AirportSearchResult[]> {
  const res = await fetch(
    `https://www.airportroutes.com/api/search-airports/?q=${encodeURIComponent(query)}&limit=20`
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { hits?: Array<{ name: string; city: string; iata: string; icao: string; country_code: string }> };
  const hits = data.hits ?? [];
  return hits.map((hit) => {
    const code = hit.iata || hit.icao || "";
    const countryCode = hit.country_code || "";
    const countryName = COUNTRY_NAMES[countryCode] || countryCode;
    const name = `${hit.city} [${code}] - ${hit.name}, ${countryName}`;
    return {
      Name: name,
      Code: code,
      AirportName: hit.name,
      CountryCode: countryCode,
      CountryName: countryName,
      COUNTRY: countryCode,
      COUNTRYNAME: countryName,
    };
  });
}

export async function searchAirports(req: import("express").Request, res: Response) {
  try {
    const query = (req.query.query as string)?.trim();
    if (!query || query.length < 2) {
      return res.status(400).json({ message: "Query must be at least 2 characters." });
    }

    const countryIsoFromQuery = resolveCountryIsoFromSearchQuery(query);
    if (countryIsoFromQuery) {
      try {
        const byCountry = await fetchAirportsByCountry(countryIsoFromQuery);
        if (byCountry.length > 0) {
          return res.json(byCountry);
        }
      } catch {
        // Fall through to Riya + search fallback when country listing fails or is unavailable
      }
    }

    let items: RiyaAirportItem[] = [];
    try {
      const { statusCode, data } = await fetchRiyaGetcity(query);
      if (statusCode && statusCode < 400) {
        items = normalizeRiyaAirports(data);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("Riya airport search failed or credentials missing. Falling back to AirportRoutes:", (err as Error).message);
    }

    if (items.length === 0) {
      items = (await fetchAirportsFallback(query)).map((a) => ({
        Name: a.Name,
        Code: a.Code,
        COUNTRY: a.CountryCode,
        COUNTRYNAME: a.CountryName,
        CountryCode: a.CountryCode,
        CountryName: a.CountryName,
      }));
    }

    const airports: AirportSearchResult[] = items.map((item) => riyaItemToSearchResult(item));

    return res.json(await enrichAirportsWithNearby(prioritizeExactAirportMatch(airports, query)));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error searching airports:", error);
    return res.status(500).json({
      message: "Internal server error.",
      error: (error as Error).message,
    });
  }
}