import { Request, Response } from "express";
import bcrypt from "bcrypt";
import {
  aggregateAdminProjectAndCrewCounts,
  aggregateTicketCountsByAdmin,
  countAdmins,
  countActiveAdmins,
  countCrew,
  countCrewTickets,
  countProjects,
  createAdmin,
  findAdminByEmail,
  findAllAdmins,
  findSuperAdminById,
  findSuperAdminByEmail,
  updateSuperAdminMarkup,
} from "../models";
import { createAccessToken } from "../utils/jwt";
import { AuthenticatedRequest } from "../middleware/auth";

const SALT_ROUNDS = 10;

export async function loginSuperAdmin(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const superAdmin = await findSuperAdminByEmail(email);
    if (!superAdmin) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const isMatch = await bcrypt.compare(password, superAdmin.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const { password: _pw, ...safeSuperAdmin } = superAdmin;
    const accessToken = createAccessToken({
      userId: superAdmin.id,
      email: superAdmin.email,
      role: "superadmin",
    });

    return res.status(200).json({
      message: "Login successful.",
      accessToken,
      superAdmin: safeSuperAdmin,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error logging in superadmin:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

/** Analytics dashboard - superadmin only */
export async function getAnalytics(req: AuthenticatedRequest, res: Response) {
  try {
    const [
      totalAdmins,
      activeAdmins,
      totalProjects,
      totalCrew,
      totalTickets,
      superAdmin,
      admins,
      projectCrewCounts,
      ticketCountsByAdmin,
    ] = await Promise.all([
      countAdmins(),
      countActiveAdmins(),
      countProjects(),
      countCrew(),
      countCrewTickets(),
      req.user?.userId ? findSuperAdminById(req.user.userId) : null,
      findAllAdmins(),
      aggregateAdminProjectAndCrewCounts(),
      aggregateTicketCountsByAdmin(),
    ]);

    type ActivityRow = {
      adminId: string;
      email: string;
      projectsCount: number;
      crewCount: number;
      cancellationOutstanding?: number | null;
      cancellationSlotsRemaining?: number | null;
    };

    const adminsByActivity: ActivityRow[] = admins
      .map((a) => {
        const pc = projectCrewCounts.get(a.id) ?? { projectCount: 0, crewCount: 0 };
        const ticketCount = ticketCountsByAdmin.get(a.id) ?? 0;
        const out = a.cancellationOutstanding;
        const slots = a.cancellationSlotsRemaining;
        return {
          adminId: a.id,
          email: a.email,
          projectsCount: pc.projectCount,
          crewCount: pc.crewCount,
          cancellationOutstanding:
            typeof out === "number" && !Number.isNaN(out) ? out : null,
          cancellationSlotsRemaining:
            typeof slots === "number" && Number.isFinite(slots) ? Math.trunc(slots) : null,
          __ticketCount: ticketCount,
        };
      })
      .sort((x, y) => {
        const tx = x.__ticketCount;
        const ty = y.__ticketCount;
        if (ty !== tx) return ty - tx;
        if (y.projectsCount !== x.projectsCount) return y.projectsCount - x.projectsCount;
        if (y.crewCount !== x.crewCount) return y.crewCount - x.crewCount;
        return x.email.localeCompare(y.email);
      })
      .map(({ __ticketCount: _t, ...row }) => row);

    return res.json({
      totalAdmins,
      activeAdmins,
      totalProjects,
      totalCrew,
      totalTickets,
      markup: superAdmin?.markup ?? null,
      markupPercentage: superAdmin?.markupPercentage ?? null,
      cashback: superAdmin?.cashback ?? null,
      cancellationCharges: superAdmin?.cancellationCharges ?? null,
      adminsByActivity,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching analytics:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

/** Fetch all admins - superadmin only */
export async function getAllAdmins(_req: AuthenticatedRequest, res: Response) {
  try {
    const [admins, projectCrewCounts] = await Promise.all([
      findAllAdmins(),
      aggregateAdminProjectAndCrewCounts(),
    ]);

    const payload = admins.map((a) => {
      const pc = projectCrewCounts.get(a.id) ?? { projectCount: 0, crewCount: 0 };
      const out = a.cancellationOutstanding;
      const slots = a.cancellationSlotsRemaining;
      return {
        id: a.id,
        firstname: a.firstname,
        lastname: a.lastname,
        email: a.email,
        phone: a.phone,
        projectsCount: pc.projectCount,
        crewCount: pc.crewCount,
        cancellationOutstanding:
          typeof out === "number" && !Number.isNaN(out) ? out : null,
        cancellationSlotsRemaining:
          typeof slots === "number" && Number.isFinite(slots) ? Math.trunc(slots) : null,
      };
    });

    return res.json({ admins: payload });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching admins:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

/** Add/upsert markup, cashback, and cancellation charges for the authenticated superadmin */
export async function upsertMarkup(req: AuthenticatedRequest, res: Response) {
  try {
    const update: {
      markup?: number;
      cashback?: number | null;
      cancellationCharges?: number | null;
    } = {};

    if (req.body.markup !== undefined) {
      const raw = req.body.markup;
      const markup = typeof raw === "string" ? parseFloat(raw) : Number(raw);
      if (typeof markup !== "number" || isNaN(markup)) {
        return res.status(400).json({ message: "markup must be a valid number." });
      }
      update.markup = markup;
    }

    if (req.body.cashback !== undefined) {
      if (req.body.cashback === null) {
        update.cashback = null;
      } else {
        const raw = req.body.cashback;
        const cashback = typeof raw === "string" ? parseFloat(raw) : Number(raw);
        if (typeof cashback !== "number" || isNaN(cashback)) {
          return res.status(400).json({ message: "cashback must be a valid number or null." });
        }
        update.cashback = cashback;
      }
    }

    if (req.body.cancellationCharges !== undefined) {
      if (req.body.cancellationCharges === null) {
        update.cancellationCharges = null;
      } else {
        const raw = req.body.cancellationCharges;
        const cancellationCharges = typeof raw === "string" ? parseFloat(raw) : Number(raw);
        if (typeof cancellationCharges !== "number" || isNaN(cancellationCharges)) {
          return res.status(400).json({ message: "cancellationCharges must be a valid number or null." });
        }
        if (cancellationCharges < 0) {
          return res.status(400).json({ message: "cancellationCharges must be >= 0." });
        }
        update.cancellationCharges = cancellationCharges;
      }
    }

    if (
      update.markup === undefined &&
      update.cashback === undefined &&
      update.cancellationCharges === undefined
    ) {
      return res.status(400).json({
        message: "At least one of markup, cashback, or cancellationCharges is required.",
      });
    }

    const superAdminId = req.user?.userId;
    if (!superAdminId) {
      return res.status(401).json({ message: "Unauthorized." });
    }
    const superAdmin = await updateSuperAdminMarkup(superAdminId, update);
    if (!superAdmin) {
      return res.status(404).json({ message: "SuperAdmin not found." });
    }
    return res.status(200).json({
      message: "Updated successfully.",
      superAdmin,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error updating markup/cashback:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

/** Add/upsert percentage markup for the authenticated superadmin */
export async function upsertMarkupPercentage(req: AuthenticatedRequest, res: Response) {
  try {
    const raw =
      req.body.markup_percentage ??
      req.body.markupPercentage;

    if (raw === undefined) {
      return res.status(400).json({ message: "markup_percentage is required." });
    }

    let markupPercentage: number | null;
    if (raw === null) {
      markupPercentage = null;
    } else {
      markupPercentage = typeof raw === "string" ? parseFloat(raw) : Number(raw);
      if (typeof markupPercentage !== "number" || isNaN(markupPercentage)) {
        return res.status(400).json({ message: "markup_percentage must be a valid number or null." });
      }
      if (markupPercentage < 0) {
        return res.status(400).json({ message: "markup_percentage must be >= 0." });
      }
    }

    const superAdminId = req.user?.userId;
    if (!superAdminId) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    const superAdmin = await updateSuperAdminMarkup(superAdminId, { markupPercentage });
    if (!superAdmin) {
      return res.status(404).json({ message: "SuperAdmin not found." });
    }

    return res.status(200).json({
      message: "Updated successfully.",
      superAdmin,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error updating markup percentage:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

/** Create an admin - superadmin only */
export async function createAdminBySuperAdmin(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const { firstname, lastname, email, password, phone } = req.body;

    if (!firstname || !lastname || !email || !password || !phone) {
      return res.status(400).json({ message: "All fields are required." });
    }

    const existingAdmin = await findAdminByEmail(email);
    if (existingAdmin) {
      return res.status(409).json({ message: "Admin with this email already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const admin = await createAdmin({
      firstname,
      lastname,
      email,
      password: hashedPassword,
      phone,
    });

    return res.status(201).json({
      message: "Admin created successfully.",
      admin,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error creating admin:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}
