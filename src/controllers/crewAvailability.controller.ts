import { Response } from "express";
import mongoose from "mongoose";
import {
  createCrewAvailability,
  deleteCrewAvailability,
  findCrewAvailabilitiesByCrewId,
  findCrewAvailabilityById,
  updateCrewAvailability,
  CrewAvailabilityModel,
  toCrewAvailability,
  type CrewAvailability,
} from "../models/crewAvailability.model";
import type { AuthenticatedRequest } from "../middleware/auth";
import { ACCESS_DENIED_MESSAGE, crewOwnedByCaller } from "../lib/resource-access";
import { resolveEmployerForStorage, formatEmployerForResponse } from "../constants/employers";

function addUTCDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

async function syncCrewStatus(crewId: string) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const activeRange = await CrewAvailabilityModel.findOne({
    crew_id: new mongoose.Types.ObjectId(crewId),
    from: { $lte: today },
    to: { $gte: today },
  });

  let status = "Available";
  if (activeRange) {
    status = activeRange.status || (activeRange.isAvailable !== false ? "Available" : "Holiday / Not Available");
  }

  const { CrewModel } = await import("../models/crew.model");
  await CrewModel.findByIdAndUpdate(crewId, { current_status: status });
}

/** MD Section 3.3 — Available From = Expected Finish Date + 1 day (Phase 1 computed on read). */
function enrichAvailabilityResponse(availability: CrewAvailability) {
  const { employer: storedEmployer, ...restFields } = availability;
  const employerParts = formatEmployerForResponse(storedEmployer);
  const available_from =
    availability.isAvailable === false
      ? addUTCDays(new Date(availability.to), 1).toISOString()
      : undefined;

  return {
    ...restFields,
    ...employerParts,
    available_from,
  };
}

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
    return res.json({ availabilities: availabilities.map(enrichAvailabilityResponse) });
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

    const {
      crew_id,
      from,
      to,
      isAvailable,
      employer,
      employer_other,
      client,
      rig_vessel,
      country,
      notes,
      status,
    } = req.body as {
      crew_id?: string;
      from: Date;
      to: Date;
      isAvailable?: boolean;
      employer?: string;
      employer_other?: string;
      client?: string;
      rig_vessel?: string;
      country?: string;
      notes?: string;
      status?: string;
    };

    const unavailable = isAvailable === false;
    let resolvedEmployer: string | undefined;
    if (unavailable && employer) {
      const resolved = resolveEmployerForStorage(employer, employer_other);
      if (!resolved.ok) {
        return res.status(400).json({ message: resolved.message });
      }
      resolvedEmployer = resolved.value;
    } else if (employer) {
      const resolved = resolveEmployerForStorage(employer, employer_other);
      if (!resolved.ok) {
        return res.status(400).json({ message: resolved.message });
      }
      resolvedEmployer = resolved.value;
    }

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

    if (toDate < fromDate) {
      return res.status(400).json({ message: "to date must be on or after from date." });
    }

    // Check for overlapping ranges of any type
    // (a date range cannot be both available and unavailable)
    const overlap = await CrewAvailabilityModel.findOne({
      crew_id: new mongoose.Types.ObjectId(targetCrewId),
      from: { $lte: toDate },
      to: { $gte: fromDate },
    });

    if (overlap) {
      const typeLabel = overlap.isAvailable !== false ? "availability" : "unavailability";
      return res.status(400).json({
        message: `Overlapping ${typeLabel} exists: from ${new Date(overlap.from).toISOString().split('T')[0]} to ${new Date(overlap.to).toISOString().split('T')[0]}. Please select a date range after or before this window.`,
      });
    }

    const availability = await createCrewAvailability({
      crew_id: new mongoose.Types.ObjectId(targetCrewId),
      from: fromDate,
      to: toDate,
      isAvailable: isAvailable !== false,
      status,
      ...(resolvedEmployer ? { employer: resolvedEmployer } : {}),
      ...(client?.trim() ? { client: client.trim() } : {}),
      ...(rig_vessel?.trim() ? { rig_vessel: rig_vessel.trim() } : {}),
      ...(country?.trim() ? { country: country.trim() } : {}),
      ...(notes?.trim() ? { notes: notes.trim() } : {}),
    });

    await syncCrewStatus(targetCrewId);

    return res.status(201).json({
      message: "Availability added successfully.",
      availability: enrichAvailabilityResponse(availability),
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
    const {
      from,
      to,
      isAvailable,
      employer,
      employer_other,
      client,
      rig_vessel,
      country,
      notes,
      status,
    } = req.body as {
      from?: Date;
      to?: Date;
      isAvailable?: boolean;
      employer?: string;
      employer_other?: string;
      client?: string;
      rig_vessel?: string;
      country?: string;
      notes?: string;
      status?: string;
    };

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

    const updateData: {
      from?: Date;
      to?: Date;
      isAvailable?: boolean;
      employer?: string;
      client?: string;
      rig_vessel?: string;
      country?: string;
      notes?: string;
      status?: string;
    } = {};
    if (from !== undefined) updateData.from = new Date(from);
    if (to !== undefined) updateData.to = new Date(to);
    if (isAvailable !== undefined) updateData.isAvailable = isAvailable;
    if (client !== undefined) updateData.client = client.trim() || undefined;
    if (rig_vessel !== undefined) updateData.rig_vessel = rig_vessel.trim() || undefined;
    if (country !== undefined) updateData.country = country.trim() || undefined;
    if (notes !== undefined) updateData.notes = notes.trim() || undefined;
    if (status !== undefined) updateData.status = status;

    if (employer !== undefined) {
      const resolved = resolveEmployerForStorage(employer, employer_other);
      if (!resolved.ok) {
        return res.status(400).json({ message: resolved.message });
      }
      updateData.employer = resolved.value;
    }

    const effectiveFrom = updateData.from ?? existing.from;
    const effectiveTo = updateData.to ?? existing.to;
    if (new Date(effectiveTo) < new Date(effectiveFrom)) {
      return res.status(400).json({ message: "to date must be on or after from date." });
    }

    // Check for overlapping ranges of any type (excluding current)
    const overlap = await CrewAvailabilityModel.findOne({
      _id: { $ne: new mongoose.Types.ObjectId(availability_id) },
      crew_id: new mongoose.Types.ObjectId(associatedCrewId),
      from: { $lte: new Date(effectiveTo) },
      to: { $gte: new Date(effectiveFrom) },
    });

    if (overlap) {
      const typeLabel = overlap.isAvailable !== false ? "availability" : "unavailability";
      return res.status(400).json({
        message: `Overlapping ${typeLabel} exists: from ${new Date(overlap.from).toISOString().split('T')[0]} to ${new Date(overlap.to).toISOString().split('T')[0]}. Please select a date range after or before this window.`,
      });
    }

    const availability = await updateCrewAvailability(availability_id, updateData);
    if (availability) {
      await syncCrewStatus(associatedCrewId);
    }
    return res.json({
      message: "Availability updated successfully.",
      availability: availability ? enrichAvailabilityResponse(availability) : availability,
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

    await syncCrewStatus(associatedCrewId);

    return res.json({ message: "Availability deleted successfully." });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error deleting crew availability:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function getBulkCrewAvailabilities(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;

    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { crew_ids } = (req.query as { crew_ids?: string }) || {};
    if (!crew_ids) {
      return res.status(400).json({ message: "crew_ids parameter is required." });
    }

    const idList = crew_ids.split(",").map((id) => id.trim()).filter(Boolean);
    if (idList.length === 0) {
      return res.status(400).json({ message: "Invalid or empty crew_ids parameter." });
    }

    // Verify access to all requested crew members
    if (role !== "admin" && role !== "superadmin") {
      // Non-admins can only fetch their own
      const onlySelf = idList.every((id) => id === userId);
      if (!onlySelf) {
        return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
      }
    } else {
      // Admins: verify they own each crew
      const allowedPromises = idList.map((id) => crewOwnedByCaller(id, userId, role));
      const allowedResults = await Promise.all(allowedPromises);
      if (allowedResults.some((allowed) => !allowed)) {
        return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
      }
    }

    const availabilities = await CrewAvailabilityModel.find({
      crew_id: { $in: idList.map((id) => new mongoose.Types.ObjectId(id)) },
    });

    return res.json({
      availabilities: availabilities.map((doc) => enrichAvailabilityResponse(toCrewAvailability(doc))),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching bulk crew availabilities:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}
