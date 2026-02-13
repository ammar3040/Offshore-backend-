import { Response } from "express";
import mongoose from "mongoose";
import { acceptCrewInvite, createCrewInvite } from "../models";
import { findProjectById } from "../models/project.model";
import type { AuthenticatedRequest } from "../middleware/auth";

export async function inviteCrewToProject(
  req: import("express").Request<{ project_id: string }>,
  res: Response
) {
  try {
    const { project_id } = req.params;
    const { crew_ids } = req.body as { crew_ids: string[] };

    if (!mongoose.Types.ObjectId.isValid(project_id)) {
      return res.status(400).json({ message: "Invalid project_id." });
    }

    const project = await findProjectById(project_id);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const projectObjectId = new mongoose.Types.ObjectId(project_id);
    const invites = await Promise.all(
      crew_ids.map((crewId) =>
        createCrewInvite({
          crew_id: new mongoose.Types.ObjectId(crewId),
          project_id: projectObjectId,
        })
      )
    );

    return res.status(201).json({
      message: "Crew invitation(s) sent successfully.",
      invites,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error inviting crew to project:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function acceptInvite(
  req: AuthenticatedRequest & { params: { project_id: string } },
  res: Response
) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { project_id } = req.params;

    const invite = await acceptCrewInvite(userId, project_id);
    if (!invite) {
      return res.status(404).json({ message: "Invite not found or already processed." });
    }

    return res.json({
      message: "Invite accepted successfully.",
      invite,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error accepting invite:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}
