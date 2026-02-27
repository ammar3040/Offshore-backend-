import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, JwtPayload } from "../utils/jwt";

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export function authenticateCrew(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (!token) {
    return res.status(401).json({ message: "Access token required." });
  }

  try {
    const payload = verifyAccessToken(token);
    console.log("🚀 ~ authenticateCrew ~ payload:", payload)
    if (payload.role !== "crew") {
      return res.status(403).json({ message: "Invalid token." });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

export function authenticateAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (!token) {
    return res.status(401).json({ message: "Access token required." });
  }

  try {
    const payload = verifyAccessToken(token);
    if (payload.role !== "admin") {
      return res.status(403).json({ message: "Invalid token." });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

/** Accepts admin or superadmin - for GET routes that both roles can access */
export function authenticateAdminOrSuperAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (!token) {
    return res.status(401).json({ message: "Access token required." });
  }

  try {
    const payload = verifyAccessToken(token);
    if (payload.role !== "admin" && payload.role !== "superadmin") {
      return res.status(403).json({ message: "Admin or superadmin access required." });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

export function authenticateSuperAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (!token) {
    return res.status(401).json({ message: "Access token required." });
  }

  try {
    const payload = verifyAccessToken(token);
    if (payload.role !== "superadmin") {
      return res.status(403).json({ message: "Superadmin access required." });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

/** Accepts admin, superadmin, and crew tokens */
export function authenticateAdminOrCrew(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (!token) {
    return res.status(401).json({ message: "Access token required." });
  }

  try {
    const payload = verifyAccessToken(token);
    if (payload.role !== "admin" && payload.role !== "superadmin" && payload.role !== "crew") {
      return res.status(403).json({ message: "Invalid token." });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}
