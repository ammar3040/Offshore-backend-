import { Response } from "express";
import mongoose from "mongoose";
import {
  acceptCrewInvite,
  createCrewInvite,
  createTimesheetForCrewProject,
  findAcceptedInvitesByCrewId,
  findExistingInviteCrewIdsForProject,
  findPendingInvitesByCrewId,
} from "../models";
import { findProjectById, updateProject } from "../models/project.model";
import type { AuthenticatedRequest } from "../middleware/auth";
import {
  ACCESS_DENIED_MESSAGE,
  crewOwnedByCaller,
  projectOwnedByCaller,
} from "../lib/resource-access";

export async function inviteCrewToProject(
  req: AuthenticatedRequest & { params: { project_id: string } },
  res: Response
) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { project_id } = req.params;
    const { crew_ids } = req.body as { crew_ids: string[] };

    if (!mongoose.Types.ObjectId.isValid(project_id)) {
      return res.status(400).json({ message: "Invalid project_id." });
    }

    const projectAllowed = await projectOwnedByCaller(project_id, userId, role);
    if (!projectAllowed) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const project = await findProjectById(project_id);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    for (const crewId of crew_ids) {
      const crewAllowed = await crewOwnedByCaller(crewId, userId, role);
      if (!crewAllowed) {
        return res.status(403).json({
          message: "One or more crew members do not belong to your account.",
        });
      }
    }

    const projectObjectId = new mongoose.Types.ObjectId(project_id);
    const crewObjectIds = crew_ids.map((id) => new mongoose.Types.ObjectId(id));
    const existingCrewIds = await findExistingInviteCrewIdsForProject(projectObjectId, crewObjectIds);
    const newCrewIds = crew_ids.filter((id) => !existingCrewIds.has(id));

    if (newCrewIds.length === 0) {
      return res.status(409).json({
        message: "All selected crew members have already been invited to this project.",
        already_invited: [...existingCrewIds],
      });
    }

    const invites = await Promise.all(
      newCrewIds.map((crewId) =>
        createCrewInvite({
          crew_id: new mongoose.Types.ObjectId(crewId),
          project_id: projectObjectId,
        })
      )
    );

    return res.status(201).json({
      message: "Crew invitation(s) sent successfully.",
      invites,
      ...(existingCrewIds.size > 0 && {
        already_invited: [...existingCrewIds],
        skipped_message: `${existingCrewIds.size} crew member(s) already invited and were skipped.`,
      }),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error inviting crew to project:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function getMyPendingInvites(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required." });
    }
    const invites = await findPendingInvitesByCrewId(userId);
    return res.json({ invites });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching pending invites:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function getMyEnrolledProjects(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required." });
    }
    const acceptedInvites = await findAcceptedInvitesByCrewId(userId);
    const projectIds = [
      ...new Set(
        acceptedInvites.map((inv) => {
          const p = inv.project_id;
          return p instanceof mongoose.Types.ObjectId ? p.toString() : (p as { _id: mongoose.Types.ObjectId })._id.toString();
        })
      ),
    ];
    const projects = (
      await Promise.all(projectIds.map((id) => findProjectById(id)))
    ).filter((p): p is NonNullable<typeof p> => p != null);
    return res.json({ projects });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching enrolled projects:", error);
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
      return res.status(404).json({ message: "Invite not found or already accepted." });
    }

    const project = await findProjectById(project_id);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const participantIds = (project.participants ?? []).map((p) =>
      p instanceof mongoose.Types.ObjectId ? p : (p as { _id: mongoose.Types.ObjectId })._id
    );
    const crewObjectId = new mongoose.Types.ObjectId(userId);
    if (!participantIds.some((p) => p.toString() === userId)) {
      await updateProject(project_id, {
        participants: [...participantIds, crewObjectId],
      });
    }

    const startDate = new Date(project.duration.startDate);
    const endDate = new Date(project.duration.endDate);
    await createTimesheetForCrewProject(
      crewObjectId,
      new mongoose.Types.ObjectId(project_id),
      startDate,
      endDate
    );

    return res.json({ message: "Invite accepted successfully.", invite });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error accepting invite:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}
