import Joi from "joi";
import { BopOem, CrewStatus, PreferredRating } from "../models/crew.model";
import { EMPLOYER_VALUES } from "../constants/employers";

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/).message("must be a valid ObjectId");

const visaDetailsSchema = Joi.object({
  visa_country: Joi.string().optional().allow(""),
  visa_issue_date: Joi.string().optional().allow(""),
  visa_expiry_date: Joi.string().optional().allow(""),
});

/** Extended profile fields for create/update (MD Section 6 — Crew). */
export const extendedCrewFieldsSchema = Joi.object({
  preferred_rating: Joi.string()
    .valid(...Object.values(PreferredRating))
    .optional(),
  primary_bop_oem: Joi.string()
    .valid(...Object.values(BopOem))
    .optional(),
  secondary_skills: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string().trim().min(1)),
      Joi.string()
    )
    .optional(),
  current_status: Joi.string()
    .valid(...Object.values(CrewStatus))
    .optional(),
  last_worked: Joi.alternatives().try(Joi.date(), Joi.string().isoDate()).optional().allow(null, ""),
  visa_details: visaDetailsSchema.optional(),
});

/** Query filters for GET /crew (MD Section 7). */
export const getCrewQuerySchema = Joi.object({
  availabilityStart: Joi.string().optional(),
  availabilityEnd: Joi.string().optional(),
  type: Joi.string().valid("available", "unavailable").optional(),
  /** Calendar day used for Rig / Personnel Status / Available From on the roster. */
  asOf: Joi.string().optional(),
  status: Joi.string()
    .valid(...Object.values(CrewStatus))
    .optional(),
  rating: Joi.string()
    .valid(...Object.values(PreferredRating))
    .optional(),
  bopOem: Joi.string()
    .valid(...Object.values(BopOem))
    .optional(),
  employer: Joi.string()
    .valid(...EMPLOYER_VALUES)
    .optional(),
  availableWithinDays: Joi.number().integer().min(1).max(365).optional(),
  expiredCerts: Joi.string().valid("true", "false").optional(),
  client: Joi.string().trim().max(200).optional(),
  projectId: objectId.optional(),
});

export function parseSecondarySkills(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (Array.isArray(raw)) {
    return raw.map(String).map((s) => s.trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.map(String).map((s) => s.trim()).filter(Boolean);
        }
      } catch {
        // fall through to comma split
      }
    }
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}

export function parseVisaDetails(raw: unknown): Record<string, string> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, string>;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function parseLastWorked(raw: unknown): Date | undefined | null {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export const crewIdParamSchema = Joi.object({
  crew_id: objectId.required().messages({
    "any.required": "crew_id is required",
  }),
});

export const crewAndProjectParamsSchema = Joi.object({
  crew_id: objectId.required().messages({
    "any.required": "crew_id is required",
  }),
  project_id: objectId.required().messages({
    "any.required": "project_id is required",
  }),
});

export const crewAndTicketParamsSchema = Joi.object({
  crew_id: objectId.required().messages({
    "any.required": "crew_id is required",
  }),
  ticket_id: objectId.required().messages({
    "any.required": "ticket_id is required",
  }),
});
