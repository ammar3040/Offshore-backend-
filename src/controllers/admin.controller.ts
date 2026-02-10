import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { createAdmin, findAdminByEmail } from "../models";

const SALT_ROUNDS = 10;

export async function registerAdmin(req: Request, res: Response) {
  try {
    const { firstname, lastname, email, password, phone } = req.body;

    if (!firstname || !lastname || !email || !password || !phone) {
      return res.status(400).json({ message: "All fields are required." });
    }

    const existingAdmin = findAdminByEmail(email);
    if (existingAdmin) {
      return res.status(409).json({ message: "Admin with this email already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const admin = createAdmin({
      firstname,
      lastname,
      email,
      password: hashedPassword,
      phone,
    });

    // Do not return password
    const { password: _pw, ...safeAdmin } = admin;

    return res.status(201).json({
      message: "Admin registered successfully.",
      admin: safeAdmin,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error registering admin:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

export async function loginAdmin(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const admin = findAdminByEmail(email);
    if (!admin) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    // In a real app, you would issue a JWT or session here.
    const { password: _pw, ...safeAdmin } = admin;

    return res.status(200).json({
      message: "Login successful.",
      admin: safeAdmin,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error logging in admin:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

