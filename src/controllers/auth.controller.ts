import { Request, Response } from "express";
import bcrypt from "bcrypt";
import {
  findAdminByEmail,
  findCrewByEmailWithPassword,
  findSuperAdminByEmail,
} from "../models";
import { createAccessToken } from "../utils/jwt";

/** Centralized login - auto-detects superadmin, admin, or crew by email */
export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    // Try superadmin first, then admin, then crew
    const superAdmin = await findSuperAdminByEmail(email);
    if (superAdmin) {
      const isMatch = await bcrypt.compare(password, superAdmin.password);
      if (!isMatch) {
        return res.status(401).json({ message: "Invalid email or password." });
      }
      const { password: _pw, ...safeUser } = superAdmin;
      const accessToken = createAccessToken({
        userId: superAdmin.id,
        email: superAdmin.email,
        role: "superadmin",
      });
      return res.status(200).json({
        message: "Login successful.",
        accessToken,
        role: "superadmin",
        user: safeUser,
      });
    }

    const admin = await findAdminByEmail(email);
    if (admin) {
      const isMatch = await bcrypt.compare(password, admin.password);
      if (!isMatch) {
        return res.status(401).json({ message: "Invalid email or password." });
      }
      const { password: _pw, ...safeUser } = admin;
      const accessToken = createAccessToken({
        userId: admin.id,
        email: admin.email,
        role: "admin",
      });
      return res.status(200).json({
        message: "Login successful.",
        accessToken,
        role: "admin",
        user: safeUser,
      });
    }

    const crew = await findCrewByEmailWithPassword(email);
    if (crew) {
      const isMatch = await bcrypt.compare(password, crew.password);
      if (!isMatch) {
        return res.status(401).json({ message: "Invalid email or password." });
      }
      const { password: _p, ...safeUser } = crew;
      const accessToken = createAccessToken({
        userId: crew.id,
        email: crew.email,
        role: "crew",
      });
      return res.status(200).json({
        message: "Login successful.",
        accessToken,
        role: "crew",
        user: safeUser,
      });
    }

    return res.status(401).json({ message: "Invalid email or password." });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error logging in:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}
