import { Response } from "express";
import mongoose from "mongoose";
import type { AuthenticatedRequest } from "../middleware/auth";
import {
  createProject,
  deleteProject,
  findAllProjects,
  findProjectById,
  updateProject,
  ProjectStatus,
} from "../models";
import type { Project, ProjectDuration } from "../models/project.model";

export async function getProjects(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Authentication required." });
    }
    const projects = await findAllProjects({ createdBy: userId });
    return res.json({ projects });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching projects:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function getProjectById(req: import("express").Request<{ id: string }>, res: Response) {
  try {
    const { id } = req.params;
    const project = await findProjectById(id);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }
    return res.json({ project });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching project:", error);
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
      status?: ProjectStatus;
    };

    const participants = (body.participants ?? []).map((id) => new mongoose.Types.ObjectId(id));

    const project = await createProject({
      title: body.title,
      description: body.description,
      duration: body.duration,
      span: body.span,
      createdBy: new mongoose.Types.ObjectId(userId),
      participants,
      status: body.status,
    });

    return res.status(201).json({ message: "Project created successfully.", project });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error creating project:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function patchProject(req: import("express").Request<{ id: string }>, res: Response) {
  try {
    const { id } = req.params;
    const body = req.body as Partial<{
      title: string;
      description: string;
      duration: ProjectDuration;
      span: string;
      createdBy: string;
      participants: string[];
      status: ProjectStatus;
    }>;

    const updateData: Partial<Project> = {};
    if (body.title !== undefined) updateData.title = body.title;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.span !== undefined) updateData.span = body.span;
    if (body.createdBy !== undefined) updateData.createdBy = new mongoose.Types.ObjectId(body.createdBy);
    if (body.status !== undefined) updateData.status = body.status;
    if (body.duration !== undefined) updateData.duration = body.duration;
    if (body.participants !== undefined) {
      updateData.participants = body.participants.map((id) => new mongoose.Types.ObjectId(id));
    }

    const project = await updateProject(id, updateData);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }
    return res.json({ message: "Project updated successfully.", project });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error updating project:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function deleteProjectHandler(
  req: import("express").Request<{ id: string }>,
  res: Response
) {
  try {
    const { id } = req.params;
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
