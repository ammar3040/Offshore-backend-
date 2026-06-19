import mongoose from "mongoose";
import { Response, type Request } from "express";
import type { AuthenticatedRequest } from "../middleware/auth";
import {
  ACCESS_DENIED_MESSAGE,
  crewOwnedByCaller,
  isSuperAdmin,
  projectOwnedByCaller,
  type AccessRole,
} from "../lib/resource-access";
import { findProjectById } from "../models/project.model";
import {
  deletePayroll,
  findAllPayrolls,
  findPayrollByCrewAndProject,
  findPayrollById,
  PayrollRateType,
  upsertPayroll,
} from "../models/payroll.model";

async function crewAssignedToProject(crewId: string, projectId: string): Promise<boolean> {
  const project = await findProjectById(projectId);
  if (!project) return false;
  return project.participants.some((participantId) => {
    const id =
      typeof participantId === "object" && participantId && "_id" in participantId
        ? (participantId as { _id: { toString: () => string } })._id.toString()
        : String(participantId);
    return id === crewId;
  });
}

async function payrollAccessibleByCaller(
  payrollId: string,
  userId: string,
  role: AccessRole
): Promise<boolean> {
  const payroll = await findPayrollById(payrollId);
  if (!payroll) return false;

  const crewId = String(payroll.crew_id);
  const projectId = String(payroll.project_id);

  const [crewAllowed, projectAllowed] = await Promise.all([
    crewOwnedByCaller(crewId, userId, role),
    projectOwnedByCaller(projectId, userId, role),
  ]);

  return crewAllowed && projectAllowed;
}

export async function getPayrolls(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const payrolls = isSuperAdmin(role)
      ? await findAllPayrolls()
      : await findAllPayrolls({ createdBy: userId });

    return res.json({ payrolls });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching payroll records:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function postPayroll(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const body = req.body as {
      crew_id: string;
      project_id: string;
      rate_type: PayrollRateType;
      pay_amount: number;
    };

    const { crew_id, project_id, rate_type, pay_amount } = body;

    const [crewAllowed, projectAllowed, assigned] = await Promise.all([
      crewOwnedByCaller(crew_id, userId, role),
      projectOwnedByCaller(project_id, userId, role),
      crewAssignedToProject(crew_id, project_id),
    ]);

    if (!crewAllowed || !projectAllowed) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    if (!assigned) {
      return res.status(400).json({
        message: "Crew member is not assigned to this project.",
      });
    }

    const existing = await findPayrollByCrewAndProject(crew_id, project_id);

    const payroll = await upsertPayroll({
      crew_id: new mongoose.Types.ObjectId(crew_id),
      project_id: new mongoose.Types.ObjectId(project_id),
      rate_type,
      pay_amount,
      createdBy: new mongoose.Types.ObjectId(userId),
    });

    const status = existing ? 200 : 201;
    const message = existing
      ? "Payroll updated successfully."
      : "Payroll created successfully.";

    return res.status(status).json({ message, payroll });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error saving payroll record:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function deletePayrollHandler(
  req: AuthenticatedRequest & Request<{ id: string }>,
  res: Response
) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId || !role) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { id } = req.params;
    const allowed = await payrollAccessibleByCaller(id, userId, role);
    if (!allowed) {
      const payroll = await findPayrollById(id);
      if (!payroll) {
        return res.status(404).json({ message: "Payroll record not found." });
      }
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const deleted = await deletePayroll(id);
    if (!deleted) {
      return res.status(404).json({ message: "Payroll record not found." });
    }

    return res.json({ message: "Payroll deleted successfully." });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error deleting payroll record:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}
