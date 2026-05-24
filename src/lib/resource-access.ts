import mongoose from "mongoose";
import type { JwtPayload } from "../utils/jwt";
import { findCrewDocumentById } from "../models/crew.model";
import { findCrewTicketById } from "../models/crewTicket.model";
import { findProjectById } from "../models/project.model";
import type { Project } from "../models/project.model";
import { findRigDocumentById } from "../models/rig.model";
import { resolveProjectAdminId } from "../services/cancellation-debt";

export type AccessRole = JwtPayload["role"];

export const ACCESS_DENIED_MESSAGE = "You do not have access to this resource.";

export function isSuperAdmin(role: AccessRole): boolean {
  return role === "superadmin";
}

export function resolveOwnerId(
  createdBy: mongoose.Types.ObjectId | { id: string } | null | undefined
): string | null {
  if (!createdBy) return null;
  if (typeof createdBy === "object" && "id" in createdBy) {
    return (createdBy as { id: string }).id;
  }
  return String(createdBy);
}

export function projectOwnedByProject(project: Project, userId: string, role: AccessRole): boolean {
  if (isSuperAdmin(role)) return true;
  return resolveProjectAdminId(project) === userId;
}

export async function projectOwnedByCaller(
  projectId: string,
  userId: string,
  role: AccessRole
): Promise<boolean> {
  if (isSuperAdmin(role)) return true;
  const project = await findProjectById(projectId);
  if (!project) return false;
  return projectOwnedByProject(project, userId, role);
}

export async function rigOwnedByCaller(
  rigId: string,
  userId: string,
  role: AccessRole
): Promise<boolean> {
  if (isSuperAdmin(role)) return true;
  const raw = await findRigDocumentById(rigId);
  if (!raw) return false;
  const ownerId = raw.createdBy as mongoose.Types.ObjectId;
  return ownerId.toString() === userId;
}

export async function crewOwnedByCaller(
  crewId: string,
  userId: string,
  role: AccessRole
): Promise<boolean> {
  if (isSuperAdmin(role)) return true;
  const raw = await findCrewDocumentById(crewId);
  if (!raw?.createdBy) return false;
  const ownerId = raw.createdBy as mongoose.Types.ObjectId;
  return ownerId.toString() === userId;
}

export async function allCrewOwnedByCaller(
  crewIds: string[],
  userId: string,
  role: AccessRole
): Promise<boolean> {
  for (const crewId of crewIds) {
    if (!(await crewOwnedByCaller(crewId, userId, role))) {
      return false;
    }
  }
  return true;
}

export async function ticketAccessibleByCaller(
  ticketId: string,
  userId: string,
  role: AccessRole
): Promise<boolean> {
  const ticket = await findCrewTicketById(ticketId);
  if (!ticket) return false;

  if (role === "crew") {
    const crewId =
      typeof ticket.crew_id === "object" && ticket.crew_id && "_id" in (ticket.crew_id as object)
        ? (ticket.crew_id as { _id: { toString: () => string } })._id.toString()
        : String(ticket.crew_id);
    return crewId === userId;
  }

  if (isSuperAdmin(role)) return true;

  const projectId =
    typeof ticket.project_id === "object" && ticket.project_id && "_id" in (ticket.project_id as object)
      ? (ticket.project_id as { _id: { toString: () => string } })._id.toString()
      : String(ticket.project_id);

  return projectOwnedByCaller(projectId, userId, role);
}

export async function resolveOptionalRigAttachment(
  rigId: string | undefined,
  actorUserId: string,
  role: AccessRole
): Promise<
  | { ok: true; rigObjectId: mongoose.Types.ObjectId | undefined }
  | { ok: false; status: number; message: string }
> {
  if (rigId == null || rigId === "") return { ok: true, rigObjectId: undefined };
  const doc = await findRigDocumentById(rigId);
  if (!doc) return { ok: false, status: 404, message: "Rig not found." };
  const allowed = await rigOwnedByCaller(rigId, actorUserId, role);
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      message: "You cannot assign a rig owned by another admin.",
    };
  }
  return { ok: true, rigObjectId: new mongoose.Types.ObjectId(rigId) };
}
