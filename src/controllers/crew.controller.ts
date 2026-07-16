import bcrypt from "bcrypt";
import crypto from "crypto";
import { Response } from "express";
import { sendCrewWelcomeEmail } from "../services/email";
import {
  createCrew,
  deleteCrew,
  findAllCrew,
  findCrewByEmail,
  findCrewByEmailWithPassword,
  findCrewById,
  findCrewByIdWithPassword,
  findCrewIdsWithAvailabilityOverlappingRange,
  updateCrew,
  updateCrewPassword,
  IdentityType,
  BopOem,
  CrewStatus,
  PreferredRating,
  type CrewPublic,
} from "../models";
import mongoose from "mongoose";
import { findCrewAvailabilitiesByCrewId, CrewAvailabilityModel } from "../models/crewAvailability.model";
import {
  findAcceptedInvitesByCrewId,
  findCrewIdsWithAcceptedInvitesOverlappingRange,
  rejectCrewInvite,
} from "../models/crewInvite.model";
import {
  findActiveProjectsGroupedByCrewId,
  findProjectById,
  findProjectsByParticipantCrewId,
  type Project,
  updateProject,
} from "../models/project.model";
import {
  findActiveTravelTicketsForCrewIdsOnDate,
  type CrewTicket,
} from "../models/crewTicket.model";
import { deleteTimesheetByCrewAndProject } from "../models/timesheet.model";
import type { Crew } from "../models/crew.model";
import { createAccessToken } from "../utils/jwt";
import type { AuthenticatedRequest } from "../middleware/auth";
import {
  ACCESS_DENIED_MESSAGE,
  crewOwnedByCaller,
  isSuperAdmin,
  projectOwnedByCaller,
  projectOwnedByProject,
} from "../lib/resource-access";
import { formatEmployerForResponse, isKnownEmployer } from "../constants/employers";
import {
  parseLastWorked,
  parseSecondarySkills,
  parseVisaDetails,
} from "../validations/crew.validation";

type CrewFormPayload = Omit<Crew, "id" | "password">;

const REQUIRED_FLAT_FIELDS = [
  "firstname",
  "lastname",
  "gender",
  "email",
  "phone",
] as const;

const OPTIONAL_FLAT_FIELDS = [
  "dateOfBirth",
  "nationality",
  "alternate_phone",
  "address",
  "city",
  "country",
  "postal_code",
] as const;

const FLAT_FIELDS = [...REQUIRED_FLAT_FIELDS, ...OPTIONAL_FLAT_FIELDS] as const;

const IDENTITY_FIELDS = [
  "identity_type",
  "identity_number",
  "identity_issue_date",
  "identity_expiry_date",
] as const;

const CERTIFICATE_FIELDS = [
  "certificate_name",
  "certificate_issue_date",
  "certificate_expiry_date",
] as const;

function getString(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key];
  return typeof v === "string" ? v : undefined;
}

interface AvailabilityRecord {
  from: Date;
  to: Date;
  isAvailable?: boolean;
  employer?: string;
  client?: string;
  rig_vessel?: string;
  country?: string;
  notes?: string;
  status?: string;
  ticket_id?: mongoose.Types.ObjectId | string;
}

function crewIdFromTicketRef(ticket: CrewTicket): string | null {
  const c = ticket.crew_id as unknown;
  if (!c) return null;
  if (typeof c === "object" && c && "_id" in (c as object)) {
    return String((c as { _id: { toString: () => string } })._id);
  }
  return String(c);
}

function rigNameFromTicket(ticket: CrewTicket): string | undefined {
  const dir = (ticket as CrewTicket & { travelDirection?: string }).travelDirection;
  // Only On signer bookings show a destination rig on the roster/search
  if (dir === "RIG_TO_HOME") return undefined;

  const direct = ticket.rig_id as unknown;
  if (direct && typeof direct === "object" && "name" in (direct as object)) {
    const name = String((direct as { name?: string }).name ?? "").trim();
    if (name) return name;
  }

  const project = ticket.project_id as unknown;
  if (project && typeof project === "object") {
    const projectRig = (project as { rig_id?: { name?: string } | string }).rig_id;
    if (projectRig && typeof projectRig === "object") {
      const name = String(projectRig.name ?? "").trim();
      if (name) return name;
    }
    const title = String((project as { title?: string }).title ?? "").trim();
    if (title) return title;
  }
  return undefined;
}

function parseExtendedCrewFieldsFromBody(
  body: Record<string, unknown>
): Partial<Omit<Crew, "id" | "password">> {
  const extended: Partial<Omit<Crew, "id" | "password">> = {};

  const preferredRating = getString(body, "preferred_rating");
  if (preferredRating && Object.values(PreferredRating).includes(preferredRating as PreferredRating)) {
    extended.preferred_rating = preferredRating as PreferredRating;
  }

  const bopOem = getString(body, "primary_bop_oem");
  if (bopOem && Object.values(BopOem).includes(bopOem as BopOem)) {
    extended.primary_bop_oem = bopOem as BopOem;
  }

  const skills = parseSecondarySkills(body.secondary_skills ?? getString(body, "secondary_skills"));
  if (skills !== undefined) {
    extended.secondary_skills = skills;
  }

  const status = getString(body, "current_status");
  if (status && Object.values(CrewStatus).includes(status as CrewStatus)) {
    extended.current_status = status as CrewStatus;
  }

  const lastWorkedRaw = body.last_worked ?? getString(body, "last_worked");
  if (lastWorkedRaw !== undefined) {
    const parsed = parseLastWorked(lastWorkedRaw);
    if (parsed === null) {
      extended.last_worked = undefined;
    } else if (parsed instanceof Date) {
      extended.last_worked = parsed;
    }
  }

  const visaDetails = parseVisaDetails(body.visa_details ?? getString(body, "visa_details"));
  if (visaDetails) {
    extended.visa_details = visaDetails;
  }

  return extended;
}

function isDateInRange(date: Date, from: Date, to: Date): boolean {
  const d = date.getTime();
  return d >= new Date(from).getTime() && d <= new Date(to).getTime();
}

function isCalendarUnavailableToday(memberAvails: AvailabilityRecord[], now = new Date()): boolean {
  const hasUnavailableToday = memberAvails.some(
    (av) => isDateInRange(now, av.from, av.to) && av.isAvailable === false
  );
  if (hasUnavailableToday) return true;

  const availableRecords = memberAvails.filter((av) => av.isAvailable !== false);
  if (availableRecords.length === 0) return false;

  return !availableRecords.some((av) => isDateInRange(now, av.from, av.to));
}

function computeCrewSignal(
  activeProjects: Project[],
  memberAvails: AvailabilityRecord[],
  now = new Date()
): "GREEN" | "ORANGE" | "RED" | "UNAVAILABLE" {
  if (isCalendarUnavailableToday(memberAvails, now)) {
    return "UNAVAILABLE";
  }
  return crewAvailabilitySignal(activeProjects);
}

function getCurrentAssignmentFromAvails(
  memberAvails: AvailabilityRecord[],
  now = new Date(),
  flightOverlay?: {
    rig_vessel?: string;
    travelDirection?: string;
    notes?: string;
    from?: Date | string;
    to?: Date | string;
  } | null
) {
  const activeBlock = memberAvails.find(
    (av) =>
      (av.isAvailable === false ||
        ((av.status || "").trim().length > 0 && (av.status || "").trim() !== "Available")) &&
      isDateInRange(now, av.from, av.to)
  );

  if (!activeBlock && !flightOverlay) return null;

  const employerParts = activeBlock ? formatEmployerForResponse(activeBlock.employer) : {};
  const blockTo = activeBlock?.to ?? (flightOverlay?.to ? new Date(flightOverlay.to) : null);
  const available_from = blockTo
    ? addUTCDays(parseAsUTCDate(blockTo), 1).toISOString()
    : undefined;

  const rigVessel =
    (flightOverlay?.travelDirection !== "RIG_TO_HOME"
      ? flightOverlay?.rig_vessel
      : undefined) ||
    activeBlock?.rig_vessel ||
    undefined;

  return {
    ...employerParts,
    client: activeBlock?.client,
    rig_vessel: rigVessel,
    country: activeBlock?.country,
    from: activeBlock?.from ?? flightOverlay?.from,
    to: activeBlock?.to ?? flightOverlay?.to,
    ...(available_from ? { available_from } : {}),
    notes: activeBlock?.notes || flightOverlay?.notes,
    ...(flightOverlay?.travelDirection
      ? { travelDirection: flightOverlay.travelDirection }
      : {}),
  };
}

function crewMatchesEmployerFilter(
  memberAvails: AvailabilityRecord[],
  employerFilter: string,
  now = new Date()
): boolean {
  const activeBlock = memberAvails.find(
    (av) => av.isAvailable === false && isDateInRange(now, av.from, av.to)
  );
  if (!activeBlock?.employer) return false;

  if (employerFilter === "Other") {
    return !isKnownEmployer(activeBlock.employer);
  }
  return activeBlock.employer === employerFilter;
}

function crewAvailableWithinDays(
  memberAvails: AvailabilityRecord[],
  days: number,
  now = new Date()
): boolean {
  const today = parseAsUTCDate(now);
  const horizon = addUTCDays(today, days);

  return memberAvails.some((av) => {
    if (av.isAvailable !== false) return false;
    const availableFrom = addUTCDays(parseAsUTCDate(av.to), 1);
    return availableFrom >= today && availableFrom <= horizon;
  });
}

function crewHasExpiredCerts(crewMember: CrewPublic, now = new Date()): boolean {
  const todayMs = now.getTime();

  if (crewMember.passport?.expiry_date) {
    const passportExpiry = new Date(crewMember.passport.expiry_date).getTime();
    if (!Number.isNaN(passportExpiry) && passportExpiry < todayMs) return true;
  }

  if (crewMember.visa_details?.visa_expiry_date) {
    const visaExpiry = new Date(crewMember.visa_details.visa_expiry_date).getTime();
    if (!Number.isNaN(visaExpiry) && visaExpiry < todayMs) return true;
  }

  for (const cert of crewMember.crew_certificate ?? []) {
    const certExpiry = new Date(cert.expiry_date).getTime();
    if (!Number.isNaN(certExpiry) && certExpiry < todayMs) return true;
  }

  return false;
}

function computeExpiryWarnings(crewMember: CrewPublic, now = new Date()): string[] {
  const warnings: string[] = [];
  const todayMs = now.getTime();
  const warningHorizonMs = todayMs + 30 * 24 * 60 * 60 * 1000; // 30 days alert

  if (crewMember.passport?.expiry_date) {
    const passportExpiry = new Date(crewMember.passport.expiry_date).getTime();
    if (!Number.isNaN(passportExpiry)) {
      if (passportExpiry < todayMs) {
        warnings.push("Passport expired");
      } else if (passportExpiry < warningHorizonMs) {
        const days = Math.ceil((passportExpiry - todayMs) / (24 * 60 * 60 * 1000));
        warnings.push(`Passport expires in ${days} days`);
      }
    }
  }

  if (crewMember.visa_details?.visa_expiry_date) {
    const visaExpiry = new Date(crewMember.visa_details.visa_expiry_date).getTime();
    if (!Number.isNaN(visaExpiry)) {
      if (visaExpiry < todayMs) {
        warnings.push("Visa expired");
      } else if (visaExpiry < warningHorizonMs) {
        const days = Math.ceil((visaExpiry - todayMs) / (24 * 60 * 60 * 1000));
        warnings.push(`Visa expires in ${days} days`);
      }
    }
  }

  for (const cert of crewMember.crew_certificate ?? []) {
    const certExpiry = new Date(cert.expiry_date).getTime();
    if (!Number.isNaN(certExpiry)) {
      if (certExpiry < todayMs) {
        warnings.push(`${cert.certificate_name} expired`);
      } else if (certExpiry < warningHorizonMs) {
        const days = Math.ceil((certExpiry - todayMs) / (24 * 60 * 60 * 1000));
        warnings.push(`${cert.certificate_name} expires in ${days} days`);
      }
    }
  }

  return warnings;
}

function hasRequiredFormFields(
  body: Record<string, unknown>,
  files: { passport_document?: Express.Multer.File[]; identity_document?: Express.Multer.File[]; certificate_document?: Express.Multer.File[] }
): { ok: true; data: CrewFormPayload } | { ok: false; message: string } {
  for (const key of REQUIRED_FLAT_FIELDS) {
    if (!getString(body, key)) {
      return { ok: false, message: `Missing or invalid field: ${key}` };
    }
  }

  const passportExpiryDate = getString(body, "passport_expiry_date");
  if (!passportExpiryDate) {
    return { ok: false, message: "Missing or invalid field: passport_expiry_date" };
  }

  const passportFile = files.passport_document?.[0];
  if (!passportFile?.path) {
    return { ok: false, message: "passport_document file is required" };
  }

  const identityType = getString(body, "identity_type") as IdentityType | undefined;
  if (identityType && !Object.values(IdentityType).includes(identityType)) {
    return { ok: false, message: "identity_type must be one of: national_id, driving_license, identity_number" };
  }

  const identityFile = files.identity_document?.[0];
  const certificateFiles = files.certificate_document ?? [];
  const certificatesJson = getString(body, "certificates");
  const hasCertificateInput =
    certificatesJson ||
    certificateFiles.length > 0 ||
    CERTIFICATE_FIELDS.some((key) => getString(body, key));

  let crewCertificates: Array<{ certificate_name: string; issue_date: string; expiry_date: string; certificate_document: string }> = [];
  if (hasCertificateInput) {
    if (certificatesJson) {
      try {
        const parsed = JSON.parse(certificatesJson) as Array<{ certificate_name: string; issue_date: string; expiry_date: string }>;
        if (!Array.isArray(parsed) || parsed.length !== certificateFiles.length) {
          return { ok: false, message: "certificates array length must match number of certificate_document files" };
        }
        if (certificateFiles.length === 0 || !certificateFiles[0]?.path) {
          return { ok: false, message: "At least one certificate_document file is required when certificates are provided" };
        }
        crewCertificates = parsed.map((cert, i) => ({
          certificate_name: cert.certificate_name || "",
          issue_date: cert.issue_date,
          expiry_date: cert.expiry_date,
          certificate_document: certificateFiles[i]!.path!,
        }));
      } catch {
        return { ok: false, message: "certificates must be a valid JSON array" };
      }
    } else {
      if (certificateFiles.length > 1) {
        return { ok: false, message: "For multiple certificates, send 'certificates' as JSON array with certificate_name, issue_date, expiry_date for each" };
      }
      const certName = getString(body, "certificate_name");
      const certIssue = getString(body, "certificate_issue_date");
      const certExpiry = getString(body, "certificate_expiry_date");
      if (!certName || !certIssue || !certExpiry || !certificateFiles[0]?.path) {
        return {
          ok: false,
          message: "certificate_name, certificate_issue_date, certificate_expiry_date, and certificate_document are required when adding certificates",
        };
      }
      crewCertificates = [{
        certificate_name: certName,
        issue_date: certIssue,
        expiry_date: certExpiry,
        certificate_document: certificateFiles[0]!.path!,
      }];
    }
  }

  const hasIdentityInput =
    identityType ||
    identityFile?.path ||
    IDENTITY_FIELDS.filter((key) => key !== "identity_type").some((key) => getString(body, key));

  const data: CrewFormPayload = {
    firstname: getString(body, "firstname")!,
    lastname: getString(body, "lastname")!,
    gender: getString(body, "gender")!,
    email: getString(body, "email")!,
    phone: getString(body, "phone")!,
    passport: {
      expiry_date: passportExpiryDate,
      passport_document: passportFile.path,
      ...(getString(body, "passport_number") ? { passport_number: getString(body, "passport_number")! } : {}),
      ...(getString(body, "passport_issue_date") ? { issue_date: getString(body, "passport_issue_date")! } : {}),
      ...(getString(body, "passport_issuing_country") ? { issuing_country: getString(body, "passport_issuing_country")! } : {}),
    },
    crew_certificate: crewCertificates,
    ...(getString(body, "dateOfBirth") ? { dateOfBirth: getString(body, "dateOfBirth")! } : {}),
    ...(getString(body, "nationality") ? { nationality: getString(body, "nationality")! } : {}),
    ...(getString(body, "alternate_phone") ? { alternate_phone: getString(body, "alternate_phone")! } : {}),
    ...(getString(body, "address") ? { address: getString(body, "address")! } : {}),
    ...(getString(body, "city") ? { city: getString(body, "city")! } : {}),
    ...(getString(body, "country") ? { country: getString(body, "country")! } : {}),
    ...(getString(body, "postal_code") ? { postal_code: getString(body, "postal_code")! } : {}),
    ...(hasIdentityInput
      ? {
          identity: {
            ...(identityType ? { identity_type: identityType } : {}),
            ...(getString(body, "identity_number") ? { identity_number: getString(body, "identity_number")! } : {}),
            ...(getString(body, "identity_issue_date") ? { issue_date: getString(body, "identity_issue_date")! } : {}),
            ...(getString(body, "identity_expiry_date") ? { expiry_date: getString(body, "identity_expiry_date")! } : {}),
            ...(identityFile?.path ? { identity_document: identityFile.path } : {}),
          },
        }
      : {}),
    azerbaijan_vantage_number: getString(body, "azerbaijan_vantage_number"),
    norwegian_d_number: getString(body, "norwegian_d_number"),
    dawinci_number: getString(body, "dawinci_number"),
    vantage_number: getString(body, "vantage_number"),
    organization: getString(body, "organization"),
    linkedin: getString(body, "linkedin"),
    visa: getString(body, "visa"),
    rank: getString(body, "rank"),
    ...parseExtendedCrewFieldsFromBody(body),
  };
  return { ok: true, data };
}

interface CrewFormFiles {
  passport_document?: Express.Multer.File[];
  identity_document?: Express.Multer.File[];
  certificate_document?: Express.Multer.File[];
}

function generateAlphanumericPassword(length = 12): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** GREEN: no in-window project; ORANGE: nearest end within 7 days; RED: in-window with more than 7 days until end. */
function crewAvailabilitySignal(activeProjects: Project[]): "GREEN" | "ORANGE" | "RED" {
  if (activeProjects.length === 0) return "GREEN";
  const now = Date.now();
  let minEndMs = Infinity;
  for (const p of activeProjects) {
    const end = new Date(p.duration.endDate).getTime();
    if (end < minEndMs) minEndMs = end;
  }
  const daysLeft = (minEndMs - now) / MS_PER_DAY;
  if (daysLeft <= 7) return "ORANGE";
  return "RED";
}

function parseAsUTCDate(dateStr: string | Date): Date {
  const d = new Date(dateStr);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function addUTCDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function toUTCDateString(date: Date): string {
  return date.toISOString().split("T")[0];
}

export async function getCrew(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const crew = await (isSuperAdmin(role) ? findAllCrew() : findAllCrew({ createdBy: userId }));
    const crewIds = crew.map((c) => c.id);

    const [activeByCrewId, allAvails] = await Promise.all([
      findActiveProjectsGroupedByCrewId(),
      CrewAvailabilityModel.find({ crew_id: { $in: crewIds } }),
    ]);

    // Group availabilities by crew_id
    const availsByCrewId = new Map<string, any[]>();
    for (const av of allAvails) {
      const cid = av.crew_id.toString();
      if (!availsByCrewId.has(cid)) {
        availsByCrewId.set(cid, []);
      }
      availsByCrewId.get(cid)!.push(av);
    }

    const {
      availabilityStart,
      availabilityEnd,
      type,
      status,
      rating,
      bopOem,
      employer,
      availableWithinDays,
      expiredCerts,
      client,
      asOf: asOfQuery,
      projectId: projectIdQuery,
    } = req.query as {
      availabilityStart?: string;
      availabilityEnd?: string;
      type?: "available" | "unavailable";
      status?: CrewStatus;
      rating?: PreferredRating;
      bopOem?: BopOem;
      employer?: string;
      availableWithinDays?: string;
      expiredCerts?: string;
      client?: string;
      asOf?: string;
      projectId?: string;
    };

    let filteredCrew = crew;

    // Assignment / rig as-of date: search start, explicit asOf, or today (UTC noon for day matching)
    const asOfRaw = asOfQuery || availabilityStart;
    const asOfBase = asOfRaw ? parseAsUTCDate(asOfRaw) : parseAsUTCDate(new Date());
    const asOf = new Date(
      Date.UTC(asOfBase.getUTCFullYear(), asOfBase.getUTCMonth(), asOfBase.getUTCDate(), 12, 0, 0)
    );

    if (availabilityStart) {
      const startSearch = parseAsUTCDate(availabilityStart);
      const endSearch = availabilityEnd ? parseAsUTCDate(availabilityEnd) : parseAsUTCDate(availabilityStart);
      const searchType = type || "available";

      filteredCrew = crew.filter((c) => {
        const memberAvails = availsByCrewId.get(c.id) ?? [];

        if (searchType === "available") {
          // Default: every day in range is available unless an unavailable/occupied window covers it.
          const availableDays = new Set<string>();
          let d = new Date(startSearch);
          const endFill = new Date(endSearch);
          while (d <= endFill) {
            availableDays.add(toUTCDateString(d));
            d = addUTCDays(d, 1);
          }

          const occupiedRecords = memberAvails.filter((av) => {
            if (av.isAvailable === false) return true;
            const status = (av.status || "").trim();
            return status.length > 0 && status !== "Available";
          });

          for (const av of occupiedRecords) {
            const avFrom = parseAsUTCDate(av.from);
            const avTo = parseAsUTCDate(av.to);

            const overlapStart = avFrom > startSearch ? avFrom : startSearch;
            const overlapEnd = avTo < endSearch ? avTo : endSearch;

            if (overlapStart <= overlapEnd) {
              let dOverlap = new Date(overlapStart);
              const endDOverlap = new Date(overlapEnd);
              while (dOverlap <= endDOverlap) {
                availableDays.delete(toUTCDateString(dOverlap));
                dOverlap = addUTCDays(dOverlap, 1);
              }
            }
          }

          (c as Record<string, unknown>).availableDays = availableDays.size;
          return availableDays.size >= 1;
        } else {
          // searchType === "unavailable"
          // Collect occupied / unavailable records that overlap (including booking blocks)
          const unavailableRecords = memberAvails.filter((av) => {
            if (av.isAvailable === false) return true;
            const status = (av.status || "").trim();
            return status.length > 0 && status !== "Available";
          });

          const coveredDays = new Set<string>();
          for (const av of unavailableRecords) {
            const avFrom = parseAsUTCDate(av.from);
            const avTo = parseAsUTCDate(av.to);

            const overlapStart = avFrom > startSearch ? avFrom : startSearch;
            const overlapEnd = avTo < endSearch ? avTo : endSearch;

            if (overlapStart <= overlapEnd) {
              let d = new Date(overlapStart);
              const endD = new Date(overlapEnd);
              while (d <= endD) {
                coveredDays.add(toUTCDateString(d));
                d = addUTCDays(d, 1);
              }
            }
          }

          (c as Record<string, unknown>).availableDays = coveredDays.size;
          return coveredDays.size >= 1;
        }
      });
    }

    if (status) {
      filteredCrew = filteredCrew.filter((c) => c.current_status === status);
    }
    if (rating) {
      filteredCrew = filteredCrew.filter((c) => c.preferred_rating === rating);
    }
    if (bopOem) {
      filteredCrew = filteredCrew.filter((c) => c.primary_bop_oem === bopOem);
    }
    if (employer) {
      const now = new Date();
      filteredCrew = filteredCrew.filter((c) =>
        crewMatchesEmployerFilter(availsByCrewId.get(c.id) ?? [], employer, now)
      );
    }
    if (availableWithinDays) {
      const days = parseInt(availableWithinDays, 10);
      if (!Number.isNaN(days) && days > 0) {
        const now = new Date();
        filteredCrew = filteredCrew.filter((c) =>
          crewAvailableWithinDays(availsByCrewId.get(c.id) ?? [], days, now)
        );
      }
    }
    if (expiredCerts === "true") {
      const now = new Date();
      filteredCrew = filteredCrew.filter((c) => crewHasExpiredCerts(c, now));
    }
    if (client) {
      filteredCrew = filteredCrew.filter((c) => {
        const memberAvails = availsByCrewId.get(c.id) ?? [];
        return memberAvails.some(
          (av) => av.client && av.client.toLowerCase().includes(client.toLowerCase())
        );
      });
    }

    // Project-based availability filter: only show crew fully available for the project duration
    if (projectIdQuery && mongoose.Types.ObjectId.isValid(projectIdQuery)) {
      const filterProject = await findProjectById(projectIdQuery);
      if (filterProject && filterProject.duration?.startDate && filterProject.duration?.endDate) {
        const projStart = parseAsUTCDate(filterProject.duration.startDate);
        const projEnd = parseAsUTCDate(filterProject.duration.endDate);

        // Build set of all days in project range
        filteredCrew = filteredCrew.filter((c) => {
          const memberAvails = availsByCrewId.get(c.id) ?? [];

          // Check if any occupied/unavailable record overlaps with the project range
          const occupiedRecords = memberAvails.filter((av) => {
            if (av.isAvailable === false) return true;
            const avStatus = (av.status || "").trim();
            return avStatus.length > 0 && avStatus !== "Available";
          });

          for (const av of occupiedRecords) {
            const avFrom = parseAsUTCDate(av.from);
            const avTo = parseAsUTCDate(av.to);
            // Check if there's any overlap between occupied range and project range
            if (avFrom <= projEnd && avTo >= projStart) {
              return false; // Crew has occupied days in this project range, exclude them
            }
          }

          return true; // No overlapping occupied records, crew is available
        });
      }
    }

    const now = new Date();
    const flightTicketsOnDate = await findActiveTravelTicketsForCrewIdsOnDate(
      filteredCrew.map((c) => c.id),
      asOf
    );
    const flightByCrewId = new Map<string, CrewTicket>();
    for (const ticket of flightTicketsOnDate) {
      const cid = crewIdFromTicketRef(ticket);
      if (!cid || flightByCrewId.has(cid)) continue;
      flightByCrewId.set(cid, ticket);
    }

    const crewWithSignal = filteredCrew.map((c) => {
      const activeProjects = activeByCrewId.get(c.id) ?? [];
      const memberAvails = availsByCrewId.get(c.id) ?? [];
      const signal = computeCrewSignal(activeProjects, memberAvails, asOf);
      const flightTicket = flightByCrewId.get(c.id);
      const flightOverlay = flightTicket
        ? {
            rig_vessel: rigNameFromTicket(flightTicket),
            travelDirection:
              (flightTicket as CrewTicket & { travelDirection?: string }).travelDirection ||
              "HOME_TO_RIG",
            notes: `Flight ${flightTicket.bookingReference?.trim() || flightTicket.id}`,
            from: flightTicket.travelStart,
            to: flightTicket.travelEnd,
          }
        : null;
      const currentAssignment = getCurrentAssignmentFromAvails(memberAvails, asOf, flightOverlay);
      const expiryWarnings = computeExpiryWarnings(c, now);

      // Prefer booking/calendar status for the as-of day over stale current_status when occupied
      let current_status = c.current_status;
      if (flightTicket || currentAssignment) {
        const occupiedStatus = memberAvails.find(
          (av) =>
            (av.isAvailable === false ||
              ((av.status || "").trim().length > 0 &&
                (av.status || "").trim() !== "Available")) &&
            isDateInRange(asOf, av.from, av.to)
        );
        if (occupiedStatus?.status) {
          current_status = occupiedStatus.status as typeof c.current_status;
        } else if (flightTicket) {
          current_status =
            flightTicket.status === "APPROVED"
              ? CrewStatus.InFlight
              : CrewStatus.Confirmed;
        }
      }

      return {
        ...c,
        current_status,
        activeProjects,
        signal,
        ...(currentAssignment ? { currentAssignment } : {}),
        expiryWarnings,
      };
    });

    return res.json({ crew: crewWithSignal });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching crew:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function getCrewById(
  req: AuthenticatedRequest & { params: { crew_id: string } },
  res: Response
) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { crew_id } = req.params;

    const allowed = await crewOwnedByCaller(crew_id, userId, role);
    if (!allowed) {
      const crew = await findCrewById(crew_id);
      if (!crew) {
        return res.status(404).json({ message: "Crew not found." });
      }
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const [crew, assignedProjects, memberAvails] = await Promise.all([
      findCrewById(crew_id),
      findProjectsByParticipantCrewId(crew_id),
      findCrewAvailabilitiesByCrewId(crew_id),
    ]);

    if (!crew) {
      return res.status(404).json({ message: "Crew not found." });
    }

    const projects = isSuperAdmin(role)
      ? assignedProjects
      : assignedProjects.filter((p) => projectOwnedByProject(p, userId, role));

    const activeProjects = projects.filter((p) => {
      const nowForProject = new Date();
      return new Date(p.duration.startDate) < nowForProject && new Date(p.duration.endDate) > nowForProject;
    });

    const now = new Date();
    const asOf = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0)
    );
    const signal = computeCrewSignal(activeProjects, memberAvails, asOf);

    const flightTickets = await findActiveTravelTicketsForCrewIdsOnDate([crew_id], asOf);
    const flightTicket = flightTickets[0];
    const flightOverlay = flightTicket
      ? {
          rig_vessel: rigNameFromTicket(flightTicket),
          travelDirection:
            (flightTicket as CrewTicket & { travelDirection?: string }).travelDirection ||
            "HOME_TO_RIG",
          notes: `Flight ${flightTicket.bookingReference?.trim() || flightTicket.id}`,
          from: flightTicket.travelStart,
          to: flightTicket.travelEnd,
        }
      : null;
    const currentAssignment = getCurrentAssignmentFromAvails(memberAvails, asOf, flightOverlay);
    const expiryWarnings = computeExpiryWarnings(crew, now);

    let current_status = crew.current_status;
    if (flightTicket || currentAssignment) {
      const occupiedStatus = memberAvails.find(
        (av) =>
          (av.isAvailable === false ||
            ((av.status || "").trim().length > 0 &&
              (av.status || "").trim() !== "Available")) &&
          isDateInRange(asOf, av.from, av.to)
      );
      if (occupiedStatus?.status) {
        current_status = occupiedStatus.status as typeof crew.current_status;
      } else if (flightTicket) {
        current_status =
          flightTicket.status === "APPROVED" ? CrewStatus.InFlight : CrewStatus.Confirmed;
      }
    }

    const crewObj = {
      ...crew,
      current_status,
      signal,
      ...(currentAssignment ? { currentAssignment } : {}),
      expiryWarnings,
    };

    return res.json({ crew: crewObj, projects });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching crew:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function getCrewAvailableForProject(
  req: AuthenticatedRequest & { params: { project_id: string } },
  res: Response
) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { project_id } = req.params;

    const project = await findProjectById(project_id);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }
    if (!projectOwnedByProject(project, userId, role)) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const { startDate, endDate } = project.duration;
    const [availableCrewIds, assignedCrewIds, ownedCrew] = await Promise.all([
      findCrewIdsWithAvailabilityOverlappingRange(new Date(startDate), new Date(endDate)),
      findCrewIdsWithAcceptedInvitesOverlappingRange(new Date(startDate), new Date(endDate)),
      isSuperAdmin(role) ? findAllCrew() : findAllCrew({ createdBy: userId }),
    ]);

    const ownedCrewIds = new Set(ownedCrew.map((c) => c.id));
    const assignedSet = new Set(assignedCrewIds.map((id) => id.toString()));
    const unassignedCrewIds = availableCrewIds.filter(
      (id) => !assignedSet.has(id.toString()) && ownedCrewIds.has(id.toString())
    );

    const crew = (
      await Promise.all(unassignedCrewIds.map((id) => findCrewById(id.toString())))
    ).filter((c): c is NonNullable<typeof c> => c != null);

    return res.json({ crew });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching crew available for project:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function getCrewMe(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized." });
    }
    const crew = await findCrewById(userId);
    if (!crew) {
      return res.status(404).json({ message: "Crew not found." });
    }

    const [availability, acceptedInvites] = await Promise.all([
      findCrewAvailabilitiesByCrewId(userId),
      findAcceptedInvitesByCrewId(userId),
    ]);

    const projectIds = acceptedInvites.map((inv) => {
      const ref = inv.project_id;
      if (ref && typeof ref === "object" && "_id" in ref) {
        return (ref as { _id: mongoose.Types.ObjectId })._id.toString();
      }
      return String(ref);
    });
    const enrolledProjects = (
      await Promise.all(projectIds.map((id) => findProjectById(id)))
    ).filter((p): p is NonNullable<typeof p> => p != null);

    return res.json({
      crew,
      availability,
      enrolledProjects,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching crew:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function loginCrew(
  req: import("express").Request,
  res: Response
) {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const crew = await findCrewByEmailWithPassword(email);
    if (!crew) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const match = await bcrypt.compare(password, crew.password);
    if (!match) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const { password: _p, ...crewPublic } = crew;
    const accessToken = createAccessToken({
      userId: crewPublic.id,
      email: crewPublic.email,
      role: "crew",
    });
    return res.json({
      message: "Login successful.",
      accessToken,
      crew: crewPublic,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error logging in crew:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function postCrew(
  req: AuthenticatedRequest & { files?: CrewFormFiles },
  res: Response
) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const files = req.files || {};

    const result = hasRequiredFormFields(body, files);
    if (!result.ok) {
      return res.status(400).json({ message: result.message });
    }

    const existing = await findCrewByEmail(result.data.email);
    if (existing) {
      return res.status(409).json({ message: "Crew with this email already exists." });
    }

    const plainPassword = generateAlphanumericPassword(12);
    const hashedPassword = await bcrypt.hash(plainPassword, 10);
    const crew = await createCrew({
      ...result.data,
      password: hashedPassword,
      createdBy: new mongoose.Types.ObjectId(userId),
    });

    try {
      await sendCrewWelcomeEmail(result.data.email, result.data.firstname, plainPassword);
    } catch (emailErr) {
      // eslint-disable-next-line no-console
      console.error("Failed to send crew welcome email:", emailErr);
    }

    return res.status(201).json({
      message: "Crew created successfully.",
      crew,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error creating crew:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function resetCrewPassword(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    const { oldPassword, newPassword, confirmPassword } = req.body as {
      oldPassword?: string;
      newPassword?: string;
      confirmPassword?: string;
    };

    if (
      !oldPassword ||
      typeof oldPassword !== "string" ||
      !newPassword ||
      typeof newPassword !== "string" ||
      !confirmPassword ||
      typeof confirmPassword !== "string"
    ) {
      return res.status(400).json({
        message: "oldPassword, newPassword, and confirmPassword are required.",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "newPassword and confirmPassword do not match." });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: "newPassword must be at least 6 characters." });
    }

    const crew = await findCrewByIdWithPassword(userId);
    if (!crew) {
      return res.status(404).json({ message: "Crew not found." });
    }

    const match = await bcrypt.compare(oldPassword, crew.password);
    if (!match) {
      return res.status(401).json({ message: "Invalid old password." });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const updated = await updateCrewPassword(userId, hashedPassword);
    if (!updated) {
      return res.status(500).json({ message: "Failed to update password." });
    }

    return res.json({ message: "Password reset successfully." });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error resetting crew password:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

interface CrewFormFiles {
  passport_document?: Express.Multer.File[];
  identity_document?: Express.Multer.File[];
  certificate_document?: Express.Multer.File[];
}

/** Build partial crew update from multipart form body + optional files. */
function buildCrewUpdateFromForm(
  body: Record<string, unknown>,
  files: CrewFormFiles
): Partial<Omit<Crew, "id" | "password">> {
  const update: Record<string, unknown> = {};

  for (const key of FLAT_FIELDS) {
    const v = getString(body, key);
    if (v !== undefined) update[key] = v;
  }

  const passportDoc = files.passport_document?.[0] as (Express.Multer.File & { path?: string }) | undefined;
  const identityDoc = files.identity_document?.[0] as (Express.Multer.File & { path?: string }) | undefined;

  const passportFields: Record<string, string> = {};
  if (getString(body, "passport_number")) passportFields.passport_number = getString(body, "passport_number")!;
  if (getString(body, "passport_issue_date")) passportFields.issue_date = getString(body, "passport_issue_date")!;
  if (getString(body, "passport_expiry_date")) passportFields.expiry_date = getString(body, "passport_expiry_date")!;
  if (getString(body, "passport_issuing_country")) passportFields.issuing_country = getString(body, "passport_issuing_country")!;
  if (passportDoc?.path) passportFields.passport_document = passportDoc.path;
  if (Object.keys(passportFields).length > 0) update.passport = passportFields;

  const identityFields: Record<string, string | IdentityType> = {};
  if (getString(body, "identity_type")) identityFields.identity_type = getString(body, "identity_type") as IdentityType;
  if (getString(body, "identity_number")) identityFields.identity_number = getString(body, "identity_number")!;
  if (getString(body, "identity_issue_date")) identityFields.issue_date = getString(body, "identity_issue_date")!;
  if (getString(body, "identity_expiry_date")) identityFields.expiry_date = getString(body, "identity_expiry_date")!;
  if (identityDoc?.path) identityFields.identity_document = identityDoc.path;
  if (Object.keys(identityFields).length > 0) update.identity = identityFields;

  const certName = getString(body, "certificate_name");
  const certIssue = getString(body, "certificate_issue_date");
  const certExpiry = getString(body, "certificate_expiry_date");
  const certDocs = files?.certificate_document ?? [];
  if ((certName || certIssue || certExpiry || certDocs.length > 0) && certName && certIssue && certExpiry && certDocs.length > 0) {
    const certificatesJson = getString(body, "certificates");
    let newCerts: Array<{ certificate_name: string; issue_date: string; expiry_date: string; certificate_document: string }>;
    if (certificatesJson) {
      try {
        const parsed = JSON.parse(certificatesJson) as Array<{ certificate_name: string; issue_date: string; expiry_date: string }>;
        if (!Array.isArray(parsed) || parsed.length !== certDocs.length) {
          return update as Partial<Omit<Crew, "id" | "password">>;
        }
        newCerts = parsed.map((c, i) => ({
          certificate_name: c.certificate_name || "",
          issue_date: c.issue_date,
          expiry_date: c.expiry_date,
          certificate_document: (certDocs[i] as Express.Multer.File & { path?: string })?.path ?? "",
        })).filter((c) => c.certificate_document);
      } catch {
        return update as Partial<Omit<Crew, "id" | "password">>;
      }
    } else {
      if (certDocs.length > 1) {
        return update as Partial<Omit<Crew, "id" | "password">>;
      }
      const path = (certDocs[0] as Express.Multer.File & { path?: string })?.path;
      if (path) {
        newCerts = [{ certificate_name: certName!, issue_date: certIssue!, expiry_date: certExpiry!, certificate_document: path }];
      } else {
        return update as Partial<Omit<Crew, "id" | "password">>;
      }
    }
    if (newCerts.length > 0) {
      update.crew_certificate_add = newCerts;
    }
  }

  for (const key of ["azerbaijan_vantage_number", "norwegian_d_number", "dawinci_number", "vantage_number", "organization", "linkedin", "visa", "rank"]) {
    const v = getString(body, key);
    if (v !== undefined) update[key] = v || undefined;
  }

  Object.assign(update, parseExtendedCrewFieldsFromBody(body));

  return update as Partial<Omit<Crew, "id" | "password">>;
}

export async function patchCrew(
  req: AuthenticatedRequest & { params: { crew_id: string }; files?: CrewFormFiles },
  res: Response
) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { crew_id } = req.params;
    const body = (req.body || {}) as Record<string, unknown>;
    const files = req.files || {};

    const allowed = await crewOwnedByCaller(crew_id, userId, role);
    if (!allowed) {
      const crew = await findCrewById(crew_id);
      if (!crew) {
        return res.status(404).json({ message: "Crew not found." });
      }
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const crew = await findCrewById(crew_id);
    if (!crew) {
      return res.status(404).json({ message: "Crew not found." });
    }

    const isMultipart = Object.keys(body).length > 0 || Object.keys(files).length > 0;
    let updateData: Partial<Omit<Crew, "id" | "password">>;

    if (isMultipart) {
      const formUpdate = buildCrewUpdateFromForm(body, files);
      if (formUpdate.passport) {
        formUpdate.passport = {
          ...crew.passport,
          ...formUpdate.passport,
          passport_document:
            (formUpdate.passport as { passport_document?: string }).passport_document ||
            crew.passport.passport_document,
        };
      }
      if (formUpdate.identity) {
        formUpdate.identity = {
          ...(crew.identity ?? {}),
          ...formUpdate.identity,
          identity_document:
            (formUpdate.identity as { identity_document?: string }).identity_document ||
            crew.identity?.identity_document,
        };
      }
      const certsToAdd = (formUpdate as { crew_certificate_add?: Array<{ certificate_name: string; issue_date: string; expiry_date: string; certificate_document: string }> }).crew_certificate_add;
      if (certsToAdd?.length) {
        formUpdate.crew_certificate = [...(crew.crew_certificate || []), ...certsToAdd];
        delete (formUpdate as Record<string, unknown>).crew_certificate_add;
      }
      updateData = formUpdate;
    } else {
      updateData = body as Partial<Omit<Crew, "id" | "password">>;
    }

    if (!isMultipart) {
      const extendedFromJson = parseExtendedCrewFieldsFromBody(body);
      updateData = { ...updateData, ...extendedFromJson };
    }

    if (updateData.preferred_rating && !Object.values(PreferredRating).includes(updateData.preferred_rating)) {
      return res.status(400).json({ message: "Invalid preferred_rating value." });
    }
    if (updateData.primary_bop_oem && !Object.values(BopOem).includes(updateData.primary_bop_oem)) {
      return res.status(400).json({ message: "Invalid primary_bop_oem value." });
    }
    if (updateData.current_status && !Object.values(CrewStatus).includes(updateData.current_status)) {
      return res.status(400).json({ message: "Invalid current_status value." });
    }

    if (!updateData || Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "No update data provided." });
    }

    if (updateData.email !== undefined && updateData.email !== crew.email) {
      const existing = await findCrewByEmail(String(updateData.email));
      if (existing) {
        return res.status(409).json({ message: "Crew with this email already exists." });
      }
    }

    const identityType = (updateData as { identity?: { identity_type?: string } }).identity?.identity_type;
    if (identityType && !Object.values(IdentityType).includes(identityType as IdentityType)) {
      return res.status(400).json({
        message: "identity_type must be one of: national_id, driving_license, identity_number",
      });
    }

    const updated = await updateCrew(crew_id, updateData);
    if (!updated) {
      return res.status(500).json({ message: "Failed to update crew." });
    }

    return res.json({ message: "Crew updated successfully.", crew: updated });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error updating crew:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function deleteCrewHandler(
  req: AuthenticatedRequest & { params: { crew_id: string } },
  res: Response
) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { crew_id } = req.params;

    const allowed = await crewOwnedByCaller(crew_id, userId, role);
    if (!allowed) {
      const crew = await findCrewById(crew_id);
      if (!crew) {
        return res.status(404).json({ message: "Crew not found." });
      }
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const crew = await findCrewById(crew_id);
    if (!crew) {
      return res.status(404).json({ message: "Crew not found." });
    }

    const assignedProjects = await findProjectsByParticipantCrewId(crew_id);
    const ownedProjects = isSuperAdmin(role)
      ? assignedProjects
      : assignedProjects.filter((p) => projectOwnedByProject(p, userId, role));
    if (ownedProjects.length > 0) {
      return res.status(409).json({
        message: "Remove crew from the assigned project(s) first.",
        assignedToProjects: true,
        projects: ownedProjects.map((p) => ({ id: p.id, title: p.title })),
      });
    }

    const deleted = await deleteCrew(crew_id);
    if (!deleted) {
      return res.status(500).json({ message: "Failed to delete crew." });
    }

    return res.json({ message: "Crew deleted successfully." });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error deleting crew:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function unassignCrewFromProject(
  req: AuthenticatedRequest & { params: { crew_id: string; project_id: string } },
  res: Response
) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { crew_id, project_id } = req.params;

    const [crewAllowed, projectAllowed] = await Promise.all([
      crewOwnedByCaller(crew_id, userId, role),
      projectOwnedByCaller(project_id, userId, role),
    ]);
    if (!crewAllowed || !projectAllowed) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const [crew, project] = await Promise.all([
      findCrewById(crew_id),
      findProjectById(project_id),
    ]);

    if (!crew) {
      return res.status(404).json({ message: "Crew not found." });
    }
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const participantIds = (project.participants ?? []).map((p) =>
      p instanceof mongoose.Types.ObjectId ? p : (p as { _id: mongoose.Types.ObjectId })._id
    );
    const isParticipant = participantIds.some((p) => p.toString() === crew_id);

    if (!isParticipant) {
      return res.status(400).json({
        message: "Crew is not assigned to this project.",
      });
    }

    const filteredParticipants = participantIds.filter((p) => p.toString() !== crew_id);

    await Promise.all([
      updateProject(project_id, { participants: filteredParticipants }),
      rejectCrewInvite(crew_id, project_id),
      deleteTimesheetByCrewAndProject(crew_id, project_id),
    ]);

    return res.json({
      status: 200,
      success: true,
      message: "Crew removed from project successfully.",
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error unassigning crew from project:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

