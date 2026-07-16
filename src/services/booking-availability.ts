import mongoose from "mongoose";
import { CrewStatus, CrewModel } from "../models/crew.model";
import {
  CrewAvailabilityModel,
  createCrewAvailability,
} from "../models/crewAvailability.model";
import { CrewTicketStatus, type CrewTicket } from "../models/crewTicket.model";
import { findProjectById, type Project } from "../models/project.model";

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

function directionNote(ticket: CrewTicket): string {
  const dir = (ticket as CrewTicket & { travelDirection?: string }).travelDirection;
  if (dir === "RIG_TO_HOME") return "Off signer";
  if (dir === "HOME_TO_RIG") return "On signer";
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

/** Add one day to a UTC-noon date. */
function addUTCDay(date: Date, days = 1): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + days,
    12, 0, 0
  ));
}

/**
 * Resolve the project associated with a ticket.
 * First tries the populated project_id on the ticket, then falls back to DB lookup.
 */
async function resolveProject(ticket: CrewTicket): Promise<Project | null> {
  const projectRef = ticket.project_id;
  if (!projectRef) return null;

  // If already populated as an object with duration
  if (typeof projectRef === "object" && "duration" in (projectRef as object)) {
    const proj = projectRef as unknown as Project;
    if (proj.duration?.startDate && proj.duration?.endDate) return proj;
  }

  // Resolve the ObjectId
  const projectIdStr = typeof projectRef === "object" && "_id" in (projectRef as object)
    ? String((projectRef as { _id: unknown })._id)
    : String(projectRef);

  if (!mongoose.Types.ObjectId.isValid(projectIdStr)) return null;
  return findProjectById(projectIdStr);
}

/**
 * Determine the status label for the flight availability record.
 */
function flightStatusForTicket(ticketStatus: string | undefined): string {
  if (ticketStatus === CrewTicketStatus.Approved) {
    return CrewStatus.InFlight;
  }
  // Unapproved bookings show as Confirmed
  return CrewStatus.Confirmed;
}

/**
 * When a crew ticket is created/approved, occupy travel days on the availability calendar.
 *
 * Direction-based logic:
 * - UNAPPROVED (any direction): flight dates → "Confirmed"
 * - APPROVED + HOME_TO_RIG: flight dates → "In Flight" + remaining project dates → "In Project"
 * - APPROVED + RIG_TO_HOME: flight dates → "In Flight" only (project completed, crew returning)
 *
 * Linked via ticket_id (flight block) and project_id (project block) so cancel can remove cleanly.
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
  const crewObjectId = new mongoose.Types.ObjectId(crewId);
  const dir = travelDirectionOf(ticket);
  const dirNote = directionNote(ticket);
  const rigVessel = rigVesselFromTicket(ticket);
  const isApproved = ticket.status === CrewTicketStatus.Approved;

  // --- FLIGHT AVAILABILITY RECORD ---
  const flightStatus = flightStatusForTicket(ticket.status);
  const flightNotes = [
    `Flight booking ${ticket.bookingReference?.trim() || ticket.id}`,
    ticket.status,
    dirNote || null,
  ]
    .filter(Boolean)
    .join(" · ");

  const existingFlight = await CrewAvailabilityModel.findOne({ ticket_id: ticketObjectId, project_id: { $exists: false } });
  // Also check for ones where project_id is null (legacy flight-only records)
  const existingFlightAlt = !existingFlight
    ? await CrewAvailabilityModel.findOne({ ticket_id: ticketObjectId, project_id: null })
    : null;
  const flightRecord = existingFlight || existingFlightAlt;

  if (flightRecord) {
    flightRecord.from = bounds.from;
    flightRecord.to = bounds.to;
    flightRecord.isAvailable = false;
    flightRecord.status = flightStatus;
    flightRecord.notes = flightNotes;
    flightRecord.rig_vessel = rigVessel;
    await flightRecord.save();
  } else {
    await createCrewAvailability({
      crew_id: crewObjectId,
      from: bounds.from,
      to: bounds.to,
      isAvailable: false,
      status: flightStatus,
      notes: flightNotes,
      ...(rigVessel ? { rig_vessel: rigVessel } : {}),
      ticket_id: ticketObjectId,
    });
  }

  // --- PROJECT DURATION RECORD (only for APPROVED + HOME_TO_RIG) ---
  // Remove any existing project block for this ticket first
  await CrewAvailabilityModel.deleteMany({
    ticket_id: ticketObjectId,
    project_id: { $exists: true, $ne: null },
  });

  if (isApproved && dir === "HOME_TO_RIG") {
    const project = await resolveProject(ticket);
    if (project && project.duration?.startDate && project.duration?.endDate) {
      const projectStart = calendarDateFromValue(project.duration.startDate);
      const projectEnd = calendarDateFromValue(project.duration.endDate);
      const dayAfterFlight = addUTCDay(bounds.to);

      if (projectStart && projectEnd && dayAfterFlight <= projectEnd) {
        // The "In Project" block starts the day after flight ends and goes to project end
        const projectBlockStart = dayAfterFlight;
        const projectBlockEnd = projectEnd;

        const projectObjectId = typeof project.id === "string"
          ? new mongoose.Types.ObjectId(project.id)
          : (project as unknown as { _id: mongoose.Types.ObjectId })._id;

        const projectNotes = [
          `Project: ${project.title}`,
          `${projectBlockStart.toISOString().split("T")[0]} → ${projectBlockEnd.toISOString().split("T")[0]}`,
          dirNote || null,
        ]
          .filter(Boolean)
          .join(" · ");

        await createCrewAvailability({
          crew_id: crewObjectId,
          from: projectBlockStart,
          to: projectBlockEnd,
          isAvailable: false,
          status: CrewStatus.InProject,
          notes: projectNotes,
          ...(rigVessel ? { rig_vessel: rigVessel } : {}),
          ticket_id: ticketObjectId,
          project_id: projectObjectId,
        });
      }
    }
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
