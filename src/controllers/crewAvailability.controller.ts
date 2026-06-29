import { Response } from "express";
import mongoose from "mongoose";
import {
  createCrewAvailability,
  deleteCrewAvailability,
  findCrewAvailabilitiesByCrewId,
  findCrewAvailabilityById,
  findCrewAvailabilityByIdAndCrewId,
  updateCrewAvailability,
  CrewAvailabilityModel,
} from "../models/crewAvailability.model";
import type { AuthenticatedRequest } from "../middleware/auth";
import { ACCESS_DENIED_MESSAGE, crewOwnedByCaller } from "../lib/resource-access";

export async function getCrewAvailabilities(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;

    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    let crewId: string;

    if (role === "admin" || role === "superadmin") {
      const { crew_id } = (req.query as { crew_id?: string }) || {};
      if (!crew_id) {
        return res.status(400).json({ message: "crew_id is required in query for admin." });
      }
      const allowed = await crewOwnedByCaller(crew_id, userId, role);
      if (!allowed) {
        return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
      }
      crewId = crew_id;
    } else {
      crewId = userId;
    }

    const availabilities = await findCrewAvailabilitiesByCrewId(crewId);
    return res.json({ availabilities });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching crew availabilities:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function addCrewAvailability(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;

    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { crew_id, from, to } = req.body as { crew_id?: string; from: Date; to: Date };

    let targetCrewId: string;

    if (role === "admin" || role === "superadmin") {
      if (!crew_id) {
        return res.status(400).json({ message: "crew_id is required for admin/superadmin." });
      }
      const allowed = await crewOwnedByCaller(crew_id, userId, role);
      if (!allowed) {
        return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
      }
      targetCrewId = crew_id;
    } else {
      if (crew_id && crew_id !== userId) {
        return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
      }
      targetCrewId = userId;
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (toDate <= fromDate) {
      return res.status(400).json({ message: "to date must be after from date." });
    }

    // Check for overlapping availability
    const overlap = await CrewAvailabilityModel.findOne({
      crew_id: new mongoose.Types.ObjectId(targetCrewId),
      from: { $lte: toDate },
      to: { $gte: fromDate },
    });

    if (overlap) {
      return res.status(400).json({
        message: `Overlapping availability exists: from ${new Date(overlap.from).toISOString().split('T')[0]} to ${new Date(overlap.to).toISOString().split('T')[0]}. Please select a date range after or before this window.`,
      });
    }

    const availability = await createCrewAvailability({
      crew_id: new mongoose.Types.ObjectId(targetCrewId),
      from: fromDate,
      to: toDate,
    });

    return res.status(201).json({
      message: "Availability added successfully.",
      availability,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error adding crew availability:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function updateCrewAvailabilityHandler(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;

    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { availability_id } = req.params as { availability_id: string };
    const { from, to } = req.body as { from?: Date; to?: Date };

    const existing = await findCrewAvailabilityById(availability_id);
    if (!existing) {
      return res.status(404).json({ message: "Availability not found." });
    }

    const associatedCrewId =
      typeof existing.crew_id === "object" && existing.crew_id && "_id" in existing.crew_id
        ? (existing.crew_id as any)._id.toString()
        : (existing.crew_id as any).toString();
    if (role === "admin" || role === "superadmin") {
      const allowed = await crewOwnedByCaller(associatedCrewId, userId, role);
      if (!allowed) {
        return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
      }
    } else {
      if (associatedCrewId !== userId) {
        return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
      }
    }

    const updateData: { from?: Date; to?: Date } = {};
    if (from !== undefined) updateData.from = new Date(from);
    if (to !== undefined) updateData.to = new Date(to);

    const effectiveFrom = updateData.from ?? existing.from;
    const effectiveTo = updateData.to ?? existing.to;
    if (new Date(effectiveTo) <= new Date(effectiveFrom)) {
      return res.status(400).json({ message: "to date must be after from date." });
    }

    // Check for overlapping availability (excluding current)
    const overlap = await CrewAvailabilityModel.findOne({
      _id: { $ne: new mongoose.Types.ObjectId(availability_id) },
      crew_id: new mongoose.Types.ObjectId(associatedCrewId),
      from: { $lte: new Date(effectiveTo) },
      to: { $gte: new Date(effectiveFrom) },
    });

    if (overlap) {
      return res.status(400).json({
        message: `Overlapping availability exists: from ${new Date(overlap.from).toISOString().split('T')[0]} to ${new Date(overlap.to).toISOString().split('T')[0]}. Please select a date range after or before this window.`,
      });
    }

    const availability = await updateCrewAvailability(availability_id, updateData);
    return res.json({
      message: "Availability updated successfully.",
      availability,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error updating crew availability:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function deleteCrewAvailabilityHandler(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;

    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { availability_id } = req.params as { availability_id: string };

    const existing = await findCrewAvailabilityById(availability_id);
    if (!existing) {
      return res.status(404).json({ message: "Availability not found." });
    }

    const associatedCrewId =
      typeof existing.crew_id === "object" && existing.crew_id && "_id" in existing.crew_id
        ? (existing.crew_id as any)._id.toString()
        : (existing.crew_id as any).toString();
    if (role === "admin" || role === "superadmin") {
      const allowed = await crewOwnedByCaller(associatedCrewId, userId, role);
      if (!allowed) {
        return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
      }
    } else {
      if (associatedCrewId !== userId) {
        return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
      }
    }

    const deleted = await deleteCrewAvailability(availability_id);
    if (!deleted) {
      return res.status(500).json({ message: "Failed to delete availability." });
    }

    return res.json({ message: "Availability deleted successfully." });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error deleting crew availability:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}
