import { Response } from "express";
import mongoose from "mongoose";
import type { AuthenticatedRequest } from "../middleware/auth";
import {
  findProjectById,
  findTimesheetByCrewAndProject,
  findTimesheetById,
  findTimesheetsByCrew,
  findTimesheetsByProject,
  updateTimesheetEntryStatusByCrewAndProject,
  AttendanceStatus,
} from "../models";

export async function getTimesheetById(
  req: import("express").Request<{ id: string }>,
  res: Response
) {
  try {
    const { id } = req.params;
    const timesheet = await findTimesheetById(id);
    if (!timesheet) {
      return res.status(404).json({ message: "Timesheet not found." });
    }
    return res.json({ timesheet });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching timesheet:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function getTimesheetByCrewAndProject(
  req: AuthenticatedRequest & { params: { project_id: string } },
  res: Response
) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { project_id } = req.params;
    const timesheet = await findTimesheetByCrewAndProject(userId, project_id);
    if (!timesheet) {
      return res.status(404).json({ message: "Timesheet not found for this crew and project." });
    }
    return res.json({ timesheet });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching timesheet:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function getMyTimesheets(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const timesheets = await findTimesheetsByCrew(userId);
    return res.json({ timesheets });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching timesheets:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function getTimesheetsByProject(
  req: import("express").Request<{ project_id: string }>,
  res: Response
) {
  try {
    const { project_id } = req.params;
    const timesheets = await findTimesheetsByProject(project_id);
    return res.json({ timesheets });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching project timesheets:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function patchTimesheetEntryStatus(
  req: AuthenticatedRequest & {
    params: { project_id: string };
    body: { date: string | Date; status: AttendanceStatus };
  },
  res: Response
) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { project_id } = req.params;
    const { date, status } = req.body;

    const project = await findProjectById(project_id);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const timesheet = await updateTimesheetEntryStatusByCrewAndProject(
      new mongoose.Types.ObjectId(userId),
      project_id,
      date,
      status,
      project.duration.startDate,
      project.duration.endDate
    );

    if (!timesheet) {
      return res.status(404).json({
        message: "Timesheet not found or date not in project range.",
      });
    }

    return res.json({
      message: "Attendance status updated successfully.",
      timesheet,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error updating timesheet entry:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}
