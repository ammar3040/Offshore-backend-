import mongoose from "mongoose";
import { Response, type Request } from "express";
import type { AuthenticatedRequest } from "../middleware/auth";
import {
  createRig,
  deleteRig,
  findAllRigs,
  findRigById,
  findRigDocumentById,
  updateRig,
} from "../models/rig.model";

async function rigOwnedByCaller(
  rigId: string,
  userId: string,
  role: "admin" | "superadmin" | "crew"
): Promise<boolean> {
  if (role === "superadmin") return true;
  const raw = await findRigDocumentById(rigId);
  if (!raw) return false;
  const ownerId = raw.createdBy as mongoose.Types.ObjectId;
  return ownerId.toString() === userId;
}

export async function getRigs(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required." });
    }
    const rigs = await findAllRigs({ createdBy: userId });
    return res.json({ rigs });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching rigs:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function getRigById(req: import("express").Request<{ id: string }>, res: Response) {
  try {
    const { id } = req.params;
    const rig = await findRigById(id);
    if (!rig) {
      return res.status(404).json({ message: "Rig not found." });
    }
    return res.json({ rig });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching rig:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function postRig(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const body = req.body as { name: string; description?: string };

    const rig = await createRig({
      name: body.name,
      description: body.description,
      createdBy: new mongoose.Types.ObjectId(userId),
    });

    return res.status(201).json({ message: "Rig created successfully.", rig });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error creating rig:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function patchRig(req: AuthenticatedRequest & Request<{ id: string }>, res: Response) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { id } = req.params;
    const body = req.body as { name?: string; description?: string };

    const allowed = await rigOwnedByCaller(id, userId, role);
    if (!allowed) {
      return res.status(403).json({ message: "You do not have access to modify this rig." });
    }

    const updateData: Partial<{ name: string; description: string | undefined }> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;

    const rig = await updateRig(id, updateData);
    if (!rig) {
      return res.status(404).json({ message: "Rig not found." });
    }
    return res.json({ message: "Rig updated successfully.", rig });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error updating rig:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function deleteRigHandler(req: AuthenticatedRequest & Request<{ id: string }>, res: Response) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { id } = req.params;

    const allowed = await rigOwnedByCaller(id, userId, role);
    if (!allowed) {
      return res.status(403).json({ message: "You do not have access to delete this rig." });
    }

    const deleted = await deleteRig(id);
    if (!deleted) {
      return res.status(404).json({ message: "Rig not found." });
    }
    return res.json({ message: "Rig deleted successfully." });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error deleting rig:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}
