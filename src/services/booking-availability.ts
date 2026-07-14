import mongoose from "mongoose";
import { CrewStatus, CrewModel } from "../models/crew.model";
import {
  CrewAvailabilityModel,
  createCrewAvailability,
} from "../models/crewAvailability.model";
import { CrewTicketStatus, type CrewTicket } from "../models/crewTicket.model";

/** Parse YYYY-MM-DD (or leading date of ISO) into a stable UTC-noon Date for calendar day matching. */
function calendarDateFromValue(value?: string | Date | null): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 12, 0, 0));
  }
  const raw = String(value).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
}

function boundsFromFlightSnapshot(ticket: CrewTicket): { from: Date; to: Date } | null {
  const legs = ticket.flightSnapshot?.legs ?? [];
  if (legs.length === 0) return null;
  const first = legs[0];
  const last = legs[legs.length - 1];
  const firstSeg = first.itinerary?.[0];
  const lastSeg =
    last.itinerary && last.itinerary.length > 0
      ? last.itinerary[last.itinerary.length - 1]
      : undefined;
  const dep = first.departureTime || firstSeg?.departureTime;
  const arr = last.arrivalTime || lastSeg?.arrivalTime || first.arrivalTime;
  const from = calendarDateFromValue(dep);
  const to = calendarDateFromValue(arr) ?? from;
  if (!from || !to) return null;
  return from <= to ? { from, to } : { from: to, to: from };
}

function ticketTravelBounds(ticket: CrewTicket): { from: Date; to: Date } | null {
  if (ticket.travelStart && ticket.travelEnd) {
    const from = calendarDateFromValue(ticket.travelStart);
    const to = calendarDateFromValue(ticket.travelEnd);
    if (from && to) {
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
  return boundsFromFlightSnapshot(ticket);
}

function crewIdFromTicket(ticket: CrewTicket): string | null {
  const c = ticket.crew_id;
  if (!c) return null;
  if (typeof c === "object" && c && "_id" in (c as object)) {
    return (c as { _id: { toString: () => string } })._id.toString();
  }
  return String(c);
}

async function syncCrewCurrentStatus(crewId: string): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(crewId)) return;
  const today = new Date();
  const todayNoon = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12, 0, 0));

  const activeRange = await CrewAvailabilityModel.findOne({
    crew_id: new mongoose.Types.ObjectId(crewId),
    from: { $lte: todayNoon },
    to: { $gte: todayNoon },
  });

  let status: string = CrewStatus.Available;
  if (activeRange) {
    status =
      activeRange.status ||
      (activeRange.isAvailable !== false ? CrewStatus.Available : CrewStatus.Holiday);
  }

  await CrewModel.findByIdAndUpdate(crewId, { current_status: status });
}

function bookingStatusForTicket(ticketStatus: string | undefined): string {
  // Pending/approval bookings occupy days with Confirmed; approved → On assignment
  return ticketStatus === CrewTicketStatus.Approved
    ? CrewStatus.OnAssignment
    : CrewStatus.Confirmed;
}

function directionNote(ticket: CrewTicket): string {
  const dir = (ticket as CrewTicket & { travelDirection?: string }).travelDirection;
  if (dir === "RIG_TO_HOME") return "Rig → Home port";
  if (dir === "HOME_TO_RIG") return "Home port → Rig";
  return "";
}

function travelDirectionOf(ticket: CrewTicket): "HOME_TO_RIG" | "RIG_TO_HOME" | undefined {
  const dir = (ticket as CrewTicket & { travelDirection?: string }).travelDirection;
  if (dir === "RIG_TO_HOME") return "RIG_TO_HOME";
  if (dir === "HOME_TO_RIG") return "HOME_TO_RIG";
  return undefined;
}

/** Rig display name from ticket.rig_id or nested project.rig_id (when Home → Rig). */
function rigVesselFromTicket(ticket: CrewTicket): string | undefined {
  if (travelDirectionOf(ticket) === "RIG_TO_HOME") return undefined;

  const direct = ticket.rig_id as unknown;
  if (direct && typeof direct === "object" && "name" in (direct as object)) {
    const name = String((direct as { name?: string }).name ?? "").trim();
    if (name) return name;
  }

  const project = ticket.project_id as unknown;
  if (project && typeof project === "object" && "rig_id" in (project as object)) {
    const projectRig = (project as { rig_id?: { name?: string } | string }).rig_id;
    if (projectRig && typeof projectRig === "object") {
      const name = String(projectRig.name ?? "").trim();
      if (name) return name;
    }
  }

  if (project && typeof project === "object" && "title" in (project as object)) {
    const title = String((project as { title?: string }).title ?? "").trim();
    if (title) return title;
  }

  return undefined;
}

/**
 * When a crew ticket is created/approved, occupy travel days on the availability calendar.
 * Linked via ticket_id so cancel can remove the block cleanly.
 */
export async function upsertBookingAvailabilityForTicket(ticket: CrewTicket): Promise<void> {
  const crewId = crewIdFromTicket(ticket);
  if (!crewId || !mongoose.Types.ObjectId.isValid(crewId)) return;
  if (ticket.status === CrewTicketStatus.Cancelled) {
    await removeBookingAvailabilityForTicket(ticket.id);
    return;
  }

  const bounds = ticketTravelBounds(ticket);
  if (!bounds) {
    // eslint-disable-next-line no-console
    console.warn(`[booking-availability] No travel bounds for ticket ${ticket.id}`);
    return;
  }

  const ticketObjectId = new mongoose.Types.ObjectId(ticket.id);
  const status = bookingStatusForTicket(ticket.status);
  const existing = await CrewAvailabilityModel.findOne({ ticket_id: ticketObjectId });
  const dir = directionNote(ticket);
  const rigVessel = rigVesselFromTicket(ticket);
  const notes = [
    `Flight booking ${ticket.bookingReference?.trim() || ticket.id}`,
    ticket.status,
    dir || null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (existing) {
    existing.from = bounds.from;
    existing.to = bounds.to;
    existing.isAvailable = false;
    existing.status = status;
    existing.notes = notes;
    existing.rig_vessel = rigVessel;
    await existing.save();
  } else {
    await createCrewAvailability({
      crew_id: new mongoose.Types.ObjectId(crewId),
      from: bounds.from,
      to: bounds.to,
      isAvailable: false,
      status,
      notes,
      ...(rigVessel ? { rig_vessel: rigVessel } : {}),
      ticket_id: ticketObjectId,
    });
  }

  await syncCrewCurrentStatus(crewId);
}

export async function removeBookingAvailabilityForTicket(ticketId: string): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(ticketId)) return;
  const docs = await CrewAvailabilityModel.find({
    ticket_id: new mongoose.Types.ObjectId(ticketId),
  });
  const crewIds = [
    ...new Set(docs.map((d) => d.crew_id?.toString()).filter(Boolean) as string[]),
  ];
  await CrewAvailabilityModel.deleteMany({
    ticket_id: new mongoose.Types.ObjectId(ticketId),
  });
  await Promise.all(crewIds.map((id) => syncCrewCurrentStatus(id)));
}

/** Re-sync all non-cancelled tickets that have travel windows (repair / migration helper). */
export async function resyncBookingAvailabilityForTicket(ticket: CrewTicket): Promise<void> {
  await upsertBookingAvailabilityForTicket(ticket);
}
