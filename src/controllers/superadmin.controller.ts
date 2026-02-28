import { Request, Response } from "express";
import bcrypt from "bcrypt";
import {
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
    const [totalAdmins, activeAdmins, totalProjects, totalCrew, totalTickets, superAdmin] =
      await Promise.all([
        countAdmins(),
        countActiveAdmins(),
        countProjects(),
        countCrew(),
        countCrewTickets(),
        req.user?.userId ? findSuperAdminById(req.user.userId) : null,
      ]);

    return res.json({
      totalAdmins,
      activeAdmins,
      totalProjects,
      totalCrew,
      totalTickets,
      markup: superAdmin?.markup ?? null,
      cashback: superAdmin?.cashback ?? null,
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
    const admins = await findAllAdmins();
    return res.json({ admins });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching admins:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

/** Add/upsert markup and cashback for the authenticated superadmin */
export async function upsertMarkup(req: AuthenticatedRequest, res: Response) {
  try {
    const update: { markup?: number; cashback?: number | null } = {};

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

    if (update.markup === undefined && update.cashback === undefined) {
      return res.status(400).json({ message: "At least one of markup or cashback is required." });
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
