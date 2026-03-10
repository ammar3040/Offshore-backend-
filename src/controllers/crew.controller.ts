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
} from "../models";
import mongoose from "mongoose";
import { findCrewAvailabilitiesByCrewId } from "../models/crewAvailability.model";
import {
  findAcceptedInvitesByCrewId,
  findCrewIdsWithAcceptedInvitesOverlappingRange,
  rejectCrewInvite,
} from "../models/crewInvite.model";
import {
  findProjectById,
  findProjectsByParticipantCrewId,
  updateProject,
} from "../models/project.model";
import { deleteTimesheetByCrewAndProject } from "../models/timesheet.model";
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
  "certificate_name",
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
  const certificateFiles = files.certificate_document ?? [];
  if (!passportFile?.path) {
    return { ok: false, message: "passport_document file is required" };
  }
  if (!identityFile?.path) {
    return { ok: false, message: "identity_document file is required" };
  }
  if (certificateFiles.length === 0 || !certificateFiles[0]?.path) {
    return { ok: false, message: "At least one certificate_document file is required" };
  }

  // Build certificates array: use "certificates" JSON if provided, else single cert from flat fields
  let crewCertificates: Array<{ certificate_name: string; issue_date: string; expiry_date: string; certificate_document: string }>;
  const certificatesJson = getString(body, "certificates");
  if (certificatesJson) {
    try {
      const parsed = JSON.parse(certificatesJson) as Array<{ certificate_name: string; issue_date: string; expiry_date: string }>;
      if (!Array.isArray(parsed) || parsed.length !== certificateFiles.length) {
        return { ok: false, message: "certificates array length must match number of certificate_document files" };
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
    if (!certName || !certIssue || !certExpiry) {
      return { ok: false, message: "certificate_name, certificate_issue_date, certificate_expiry_date are required" };
    }
    crewCertificates = [{
      certificate_name: certName,
      issue_date: certIssue,
      expiry_date: certExpiry,
      certificate_document: certificateFiles[0]!.path!,
    }];
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
    crew_certificate: crewCertificates,
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

export async function getCrewById(
  req: import("express").Request<{ crew_id: string }>,
  res: Response
) {
  try {
    const { crew_id } = req.params;

    const [crew, assignedProjects] = await Promise.all([
      findCrewById(crew_id),
      findProjectsByParticipantCrewId(crew_id),
    ]);

    if (!crew) {
      return res.status(404).json({ message: "Crew not found." });
    }

    return res.json({ crew, projects: assignedProjects });
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

  for (const key of ["azerbaijan_vantage_number", "norwegian_d_number", "dawinci_number", "vantage_number", "organization", "linkedin", "visa"]) {
    const v = getString(body, key);
    if (v !== undefined) update[key] = v || undefined;
  }

  return update as Partial<Omit<Crew, "id" | "password">>;
}

export async function patchCrew(
  req: import("express").Request<{ crew_id: string }> & { files?: CrewFormFiles },
  res: Response
) {
  try {
    const { crew_id } = req.params;
    const body = (req.body || {}) as Record<string, unknown>;
    const files = req.files || {};

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
          ...crew.identity,
          ...formUpdate.identity,
          identity_document:
            (formUpdate.identity as { identity_document?: string }).identity_document ||
            crew.identity.identity_document,
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
  req: import("express").Request<{ crew_id: string }>,
  res: Response
) {
  try {
    const { crew_id } = req.params;

    const crew = await findCrewById(crew_id);
    if (!crew) {
      return res.status(404).json({ message: "Crew not found." });
    }

    const assignedProjects = await findProjectsByParticipantCrewId(crew_id);
    if (assignedProjects.length > 0) {
      return res.status(409).json({
        message: "Remove crew from the assigned project(s) first.",
        assignedToProjects: true,
        projects: assignedProjects.map((p) => ({ id: p.id, title: p.title })),
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
  req: import("express").Request<{ crew_id: string; project_id: string }>,
  res: Response
) {
  try {
    const { crew_id, project_id } = req.params;

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
