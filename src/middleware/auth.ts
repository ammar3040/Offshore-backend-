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
