import bcrypt from "bcrypt";
import crypto from "crypto";
import { Response } from "express";
import { sendCrewWelcomeEmail } from "../services/email";
import {
  createCrew,
  findAllCrew,
  findCrewByEmail,
  findCrewByEmailWithPassword,
  findCrewById,
  findCrewByIdWithPassword,
  findCrewIdsWithAvailabilityOverlappingRange,
  updateCrewPassword,
  IdentityType,
} from "../models";
import mongoose from "mongoose";
import { findCrewAvailabilitiesByCrewId } from "../models/crewAvailability.model";
import {
  findAcceptedInvitesByCrewId,
  findCrewIdsWithAcceptedInvitesOverlappingRange,
} from "../models/crewInvite.model";
import { findProjectById } from "../models/project.model";
import type { Crew } from "../models/crew.model";
import { createAccessToken } from "../utils/jwt";
import type { AuthenticatedRequest } from "../middleware/auth";

type CrewFormPayload = Omit<Crew, "id" | "password">;

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

const CERTIFICATE_FIELDS = [
  "certificate_issue_date",
  "certificate_expiry_date",
] as const;

function getString(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key];
  return typeof v === "string" ? v : undefined;
}

function hasRequiredFormFields(
  body: Record<string, unknown>,
  files: { passport_document?: Express.Multer.File[]; identity_document?: Express.Multer.File[]; certificate_document?: Express.Multer.File[] }
): { ok: true; data: CrewFormPayload } | { ok: false; message: string } {
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
  for (const key of CERTIFICATE_FIELDS) {
    if (!getString(body, key)) {
      return { ok: false, message: `Missing or invalid field: ${key}` };
    }
  }
  const identityType = getString(body, "identity_type") as IdentityType | undefined;
  if (!identityType || !Object.values(IdentityType).includes(identityType)) {
    return { ok: false, message: "identity_type must be one of: national_id, driving_license, identity_number" };
  }
  // const password = getString(body, "password");
  // if (!password || password.length < 6) {
  //   return { ok: false, message: "password is required and must be at least 6 characters" };
  // }
  const passportFile = files.passport_document?.[0];
  const identityFile = files.identity_document?.[0];
  const certificateFile = files.certificate_document?.[0];
  if (!passportFile?.path) {
    return { ok: false, message: "passport_document file is required" };
  }
  if (!identityFile?.path) {
    return { ok: false, message: "identity_document file is required" };
  }
  if (!certificateFile?.path) {
    return { ok: false, message: "certificate_document file is required" };
  }

  const data: CrewFormPayload = {
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
    crew_certificate: {
      issue_date: getString(body, "certificate_issue_date")!,
      expiry_date: getString(body, "certificate_expiry_date")!,
      certificate_document: certificateFile.path,
    },
    azerbaijan_vantage_number: getString(body, "azerbaijan_vantage_number"),
    norwegian_d_number: getString(body, "norwegian_d_number"),
    dawinci_number: getString(body, "dawinci_number"),
    vantage_number: getString(body, "vantage_number"),
    organization: getString(body, "organization"),
    linkedin: getString(body, "linkedin"),
    visa: getString(body, "visa"),
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

export async function getCrew(_req: import("express").Request, res: Response) {
  try {
    const crew = await findAllCrew();
    return res.json({ crew });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching crew:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function getCrewAvailableForProject(
  req: import("express").Request<{ project_id: string }>,
  res: Response
) {
  try {
    const { project_id } = req.params;

    const project = await findProjectById(project_id);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const { startDate, endDate } = project.duration;
    const [availableCrewIds, assignedCrewIds] = await Promise.all([
      findCrewIdsWithAvailabilityOverlappingRange(new Date(startDate), new Date(endDate)),
      findCrewIdsWithAcceptedInvitesOverlappingRange(new Date(startDate), new Date(endDate)),
    ]);

    const assignedSet = new Set(assignedCrewIds.map((id) => id.toString()));
    const unassignedCrewIds = availableCrewIds.filter((id) => !assignedSet.has(id.toString()));

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

    const plainPassword = generateAlphanumericPassword(12);
    const hashedPassword = await bcrypt.hash(plainPassword, 10);
    const crew = await createCrew({ ...result.data, password: hashedPassword });

    // eslint-disable-next-line no-console
    console.log("Crew created - generated password for", result.data.email, ":", plainPassword);

    await sendCrewWelcomeEmail(result.data.email, result.data.firstname, plainPassword);

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
