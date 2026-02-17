import { Response } from "express";
import mongoose from "mongoose";
import {
  createCrewAvailability,
  deleteCrewAvailability,
  findCrewAvailabilitiesByCrewId,
  findCrewAvailabilityByIdAndCrewId,
  updateCrewAvailability,
} from "../models/crewAvailability.model";
import type { AuthenticatedRequest } from "../middleware/auth";

export async function getCrewAvailabilities(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;

    if (!userId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    let crewId: string;

    if (role === "admin") {
      const { crew_id } = (req.query as { crew_id?: string }) || {};
      if (!crew_id) {
        return res.status(400).json({ message: "crew_id is required in query for admin." });
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

    if (!userId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { from, to } = req.body as { from: Date; to: Date };

    const availability = await createCrewAvailability({
      crew_id: new mongoose.Types.ObjectId(userId),
      from: new Date(from),
      to: new Date(to),
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

    if (!userId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { availability_id } = req.params as { availability_id: string };
    const { from, to } = req.body as { from?: Date; to?: Date };

    const existing = await findCrewAvailabilityByIdAndCrewId(availability_id, userId);
    if (!existing) {
      return res.status(404).json({ message: "Availability not found or access denied." });
    }

    const updateData: { from?: Date; to?: Date } = {};
    if (from !== undefined) updateData.from = new Date(from);
    if (to !== undefined) updateData.to = new Date(to);

    const effectiveFrom = updateData.from ?? existing.from;
    const effectiveTo = updateData.to ?? existing.to;
    if (new Date(effectiveTo) <= new Date(effectiveFrom)) {
      return res.status(400).json({ message: "to date must be after from date." });
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

    if (!userId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { availability_id } = req.params as { availability_id: string };

    const existing = await findCrewAvailabilityByIdAndCrewId(availability_id, userId);
    if (!existing) {
      return res.status(404).json({ message: "Availability not found or access denied." });
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
