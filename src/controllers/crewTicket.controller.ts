import { Response } from "express";
import mongoose from "mongoose";
import {
  createCrewTicket,
  deleteCrewTicket,
  findCrewTicketByProjectAndCrew,
  findCrewTicketById,
  findAllCrewTickets,
  findCrewById,
  findProjectById,
  updateCrewTicket,
} from "../models";
import type { CabinClass, TripType } from "../models/crewTicket.model";

export async function getCrewTickets(_req: import("express").Request, res: Response) {
  try {
    const tickets = await findAllCrewTickets();
    return res.json({ crewTickets: tickets });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching crew tickets:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function getCrewTicketById(
  req: import("express").Request<{ id: string }>,
  res: Response
) {
  try {
    const { id } = req.params;
    const ticket = await findCrewTicketById(id);
    if (!ticket) {
      return res.status(404).json({ message: "Crew ticket not found." });
    }
    return res.json({ crewTicket: ticket });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching crew ticket:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function postCrewTicket(req: import("express").Request, res: Response) {
  try {
    const body = req.body as {
      crew_id: string;
      project_id: string;
      from: { Name: string; COUNTRY: string; COUNTRYNAME: string };
      to: { Name: string; COUNTRY: string; COUNTRYNAME: string };
      class: string;
      adult: number;
      children?: number;
      infants?: number;
      trip: string;
    };

    if (!mongoose.Types.ObjectId.isValid(body.crew_id)) {
      return res.status(400).json({ message: "Invalid crew_id." });
    }
    if (!mongoose.Types.ObjectId.isValid(body.project_id)) {
      return res.status(400).json({ message: "Invalid project_id." });
    }

    const [project, crew] = await Promise.all([
      findProjectById(body.project_id),
      findCrewById(body.crew_id),
    ]);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }
    if (!crew) {
      return res.status(404).json({ message: "Crew not found." });
    }

    const existing = await findCrewTicketByProjectAndCrew(body.project_id, body.crew_id);
    if (existing) {
      return res.status(409).json({
        message: "A crew ticket already exists for this project and crew.",
      });
    }

    const ticket = await createCrewTicket({
      crew_id: new mongoose.Types.ObjectId(body.crew_id),
      project_id: new mongoose.Types.ObjectId(body.project_id),
      from: body.from,
      to: body.to,
      class: body.class as import("../models/crewTicket.model").CabinClass,
      adult: body.adult,
      children: body.children ?? 0,
      infants: body.infants ?? 0,
      trip: body.trip as import("../models/crewTicket.model").TripType,
    });

    return res.status(201).json({
      message: "Crew ticket created successfully.",
      crewTicket: ticket,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error creating crew ticket:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function patchCrewTicket(
  req: import("express").Request<{ id: string }>,
  res: Response
) {
  try {
    const { id } = req.params;
    const body = req.body as Partial<{
      from: { Name: string; COUNTRY: string; COUNTRYNAME: string };
      to: { Name: string; COUNTRY: string; COUNTRYNAME: string };
      class: CabinClass;
      adult: number;
      children: number;
      infants: number;
      trip: TripType;
    }>;

    const updateData: Partial<Omit<import("../models/crewTicket.model").CrewTicket, "id" | "crew_id" | "project_id">> = {};
    if (body.from !== undefined) updateData.from = body.from;
    if (body.to !== undefined) updateData.to = body.to;
    if (body.class !== undefined) updateData.class = body.class;
    if (body.adult !== undefined) updateData.adult = body.adult;
    if (body.children !== undefined) updateData.children = body.children;
    if (body.infants !== undefined) updateData.infants = body.infants;
    if (body.trip !== undefined) updateData.trip = body.trip;

    const ticket = await updateCrewTicket(id, updateData);
    if (!ticket) {
      return res.status(404).json({ message: "Crew ticket not found." });
    }
    return res.json({ message: "Crew ticket updated successfully.", crewTicket: ticket });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error updating crew ticket:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function deleteCrewTicketHandler(
  req: import("express").Request<{ id: string }>,
  res: Response
) {
  try {
    const { id } = req.params;
    const deleted = await deleteCrewTicket(id);
    if (!deleted) {
      return res.status(404).json({ message: "Crew ticket not found." });
    }
    return res.json({ message: "Crew ticket deleted successfully." });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error deleting crew ticket:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}
