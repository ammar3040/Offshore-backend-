import { Request, Response } from "express";
import bcrypt from "bcrypt";
import {
  createAdmin,
  findAdminByEmail,
  findAllAdmins,
  findSuperAdminByEmail,
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
