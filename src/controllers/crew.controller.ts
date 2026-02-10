import { Response } from "express";
import { createCrew, findCrewByEmail, IdentityType } from "../models";
import type { Crew } from "../models/crew.model";

type CrewCreatePayload = Omit<Crew, "id">;

const FLAT_FIELDS = [
  "firstname",
  "lastname",
  "dateOfBirth",
  "nationality",
  "gender",
  "email",
  "phone",
  "alternate_phone",
  "address",
  "city",
  "country",
  "postal_code",
] as const;

const PASSPORT_FIELDS = [
  "passport_number",
  "passport_issue_date",
  "passport_expiry_date",
  "passport_issuing_country",
] as const;

const IDENTITY_FIELDS = [
  "identity_type",
  "identity_number",
  "identity_issue_date",
  "identity_expiry_date",
] as const;

function getString(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key];
  return typeof v === "string" ? v : undefined;
}

function hasRequiredFormFields(
  body: Record<string, unknown>,
  files: { passport_document?: Express.Multer.File[]; identity_document?: Express.Multer.File[] }
): { ok: true; data: CrewCreatePayload } | { ok: false; message: string } {
  for (const key of FLAT_FIELDS) {
    if (!getString(body, key)) {
      return { ok: false, message: `Missing or invalid field: ${key}` };
    }
  }
  for (const key of PASSPORT_FIELDS) {
    if (!getString(body, key)) {
      return { ok: false, message: `Missing or invalid field: ${key}` };
    }
  }
  for (const key of IDENTITY_FIELDS) {
    if (!getString(body, key)) {
      return { ok: false, message: `Missing or invalid field: ${key}` };
    }
  }
  const identityType = getString(body, "identity_type") as IdentityType | undefined;
  if (!identityType || !Object.values(IdentityType).includes(identityType)) {
    return { ok: false, message: "identity_type must be one of: national_id, driving_license, identity_number" };
  }
  const passportFile = files.passport_document?.[0];
  const identityFile = files.identity_document?.[0];
  if (!passportFile?.path) {
    return { ok: false, message: "passport_document file is required" };
  }
  if (!identityFile?.path) {
    return { ok: false, message: "identity_document file is required" };
  }

  const data: CrewCreatePayload = {
    firstname: getString(body, "firstname")!,
    lastname: getString(body, "lastname")!,
    dateOfBirth: getString(body, "dateOfBirth")!,
    nationality: getString(body, "nationality")!,
    gender: getString(body, "gender")!,
    email: getString(body, "email")!,
    phone: getString(body, "phone")!,
    alternate_phone: getString(body, "alternate_phone")!,
    address: getString(body, "address")!,
    city: getString(body, "city")!,
    country: getString(body, "country")!,
    postal_code: getString(body, "postal_code")!,
    passport: {
      passport_number: getString(body, "passport_number")!,
      issue_date: getString(body, "passport_issue_date")!,
      expiry_date: getString(body, "passport_expiry_date")!,
      issuing_country: getString(body, "passport_issuing_country")!,
      passport_document: passportFile.path,
    },
    identity: {
      identity_type: identityType,
      identity_number: getString(body, "identity_number")!,
      issue_date: getString(body, "identity_issue_date")!,
      expiry_date: getString(body, "identity_expiry_date")!,
      identity_document: identityFile.path,
    },
  };
  return { ok: true, data };
}

interface CrewFormFiles {
  passport_document?: Express.Multer.File[];
  identity_document?: Express.Multer.File[];
}

export async function postCrew(
  req: import("express").Request & { files?: CrewFormFiles },
  res: Response
) {
  try {
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

    const crew = await createCrew(result.data);

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
