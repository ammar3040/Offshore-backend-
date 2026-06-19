import { Response } from "express";
import mongoose from "mongoose";
import type { AuthenticatedRequest } from "../middleware/auth";
import {
  ACCESS_DENIED_MESSAGE,
  allCrewOwnedByCaller,
  isSuperAdmin,
  projectOwnedByCaller,
  projectOwnedByProject,
  resolveOptionalRigAttachment,
} from "../lib/resource-access";
import {
  createProject,
  createTimesheetForCrewProject,
  deleteProject,
  findAllProjects,
  findCrewByIds,
  findProjectById,
  updateProject,
  ProjectStatus,
} from "../models";
import type { Project, ProjectDuration } from "../models/project.model";

export async function getProjects(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const projects = isSuperAdmin(role)
      ? await findAllProjects()
      : await findAllProjects({ createdBy: userId });
    return res.json({ projects });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching projects:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function getProjectById(
  req: AuthenticatedRequest & { params: { id: string } },
  res: Response
) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { id } = req.params;
    const project = await findProjectById(id);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }
    if (!projectOwnedByProject(project, userId, role)) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }
    return res.json({ project });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching project:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function getProjectCrew(
  req: AuthenticatedRequest & { params: { id: string } },
  res: Response
) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { id } = req.params;
    const project = await findProjectById(id);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }
    if (!projectOwnedByProject(project, userId, role)) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const participantIds = (project.participants ?? []).map((p) =>
      p instanceof mongoose.Types.ObjectId ? p : (p as { _id: mongoose.Types.ObjectId })._id
    );
    const crew = await findCrewByIds(participantIds);
    return res.json({ crew });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching project crew:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function postProject(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const body = req.body as {
      title: string;
      description: string;
      duration: ProjectDuration;
      span: string;
      participants?: string[];
      rig_id?: string;
      status?: ProjectStatus;
    };

    const participants = (body.participants ?? []).map((id) => new mongoose.Types.ObjectId(id));

    if (participants.length > 0) {
      const crewAllowed = await allCrewOwnedByCaller(
        participants.map((id) => id.toString()),
        userId,
        "admin"
      );
      if (!crewAllowed) {
        return res.status(403).json({
          message: "One or more crew members do not belong to your account.",
        });
      }
    }

    const rigResolved = await resolveOptionalRigAttachment(body.rig_id, userId, "admin");
    if (!rigResolved.ok) {
      return res.status(rigResolved.status).json({ message: rigResolved.message });
    }

    const project = await createProject({
      title: body.title,
      description: body.description,
      duration: body.duration,
      span: body.span,
      createdBy: new mongoose.Types.ObjectId(userId),
      participants,
      status: body.status,
      ...(rigResolved.rigObjectId ? { rig_id: rigResolved.rigObjectId } : {}),
    });

    // Create timesheets for all assigned crew (all days default to PRESENT)
    const startDate = new Date(project.duration.startDate);
    const endDate = new Date(project.duration.endDate);
    const projectId = new mongoose.Types.ObjectId(project.id);
    await Promise.all(
      participants.map((crewId) =>
        createTimesheetForCrewProject(crewId, projectId, startDate, endDate)
      )
    );

    return res.status(201).json({ message: "Project created successfully.", project });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error creating project:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function patchProject(
  req: AuthenticatedRequest & { params: { id: string } },
  res: Response
) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { id } = req.params;
    const existing = await findProjectById(id);
    if (!existing) {
      return res.status(404).json({ message: "Project not found." });
    }
    if (!projectOwnedByProject(existing, userId, role)) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const body = req.body as Partial<{
      title: string;
      description: string;
      duration: ProjectDuration;
      span: string;
      createdBy: string;
      participants: string[];
      rig_id: string | null;
      status: ProjectStatus;
    }>;

    const updateData: Partial<Omit<Project, "id" | "rig_id">> & { rig_id?: mongoose.Types.ObjectId | null } =
      {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.span !== undefined) updateData.span = body.span;
    if (body.createdBy !== undefined && isSuperAdmin(role)) {
      updateData.createdBy = new mongoose.Types.ObjectId(body.createdBy);
    }
    if (body.status !== undefined) updateData.status = body.status;
    if (body.duration !== undefined) updateData.duration = body.duration;
    if (body.participants !== undefined) {
      const crewAllowed = await allCrewOwnedByCaller(body.participants, userId, role);
      if (!crewAllowed) {
        return res.status(403).json({
          message: "One or more crew members do not belong to your account.",
        });
      }
      updateData.participants = body.participants.map((pid) => new mongoose.Types.ObjectId(pid));
    }
    if (body.rig_id !== undefined) {
      if (body.rig_id === null || body.rig_id === "") {
        updateData.rig_id = null;
      } else {
        const rigResolved = await resolveOptionalRigAttachment(body.rig_id, userId, role);
        if (!rigResolved.ok) {
          return res.status(rigResolved.status).json({ message: rigResolved.message });
        }
        if (rigResolved.rigObjectId) {
          updateData.rig_id = rigResolved.rigObjectId;
        }
      }
    }

    const project = await updateProject(id, updateData);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    // Create timesheets for newly assigned crew (idempotent - skips existing)
    if (body.participants !== undefined && project.participants?.length) {
      const startDate = new Date(project.duration.startDate);
      const endDate = new Date(project.duration.endDate);
      const projectId = new mongoose.Types.ObjectId(project.id);
      await Promise.all(
        project.participants.map((crewId) =>
          createTimesheetForCrewProject(crewId as mongoose.Types.ObjectId, projectId, startDate, endDate)
        )
      );
    }

    return res.json({ message: "Project updated successfully.", project });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error updating project:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function deleteProjectHandler(
  req: AuthenticatedRequest & { params: { id: string } },
  res: Response
) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { id } = req.params;
    const existing = await findProjectById(id);
    if (!existing) {
      return res.status(404).json({ message: "Project not found." });
    }
    if (!projectOwnedByProject(existing, userId, role)) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const deleted = await deleteProject(id);
    if (!deleted) {
      return res.status(404).json({ message: "Project not found." });
    }
    return res.json({ message: "Project deleted successfully." });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error deleting project:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}
