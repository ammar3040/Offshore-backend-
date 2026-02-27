import { Router } from "express";
import {
  createAdminBySuperAdmin,
  getAllAdmins,
  getAnalytics,
  loginSuperAdmin,
  upsertMarkup,
} from "../controllers";
import { authenticateSuperAdmin } from "../middleware/auth";

const router = Router();

router.post("/login", loginSuperAdmin);
router.get("/analytics", authenticateSuperAdmin, getAnalytics);
router.get("/admins", authenticateSuperAdmin, getAllAdmins);
router.post("/admins", authenticateSuperAdmin, createAdminBySuperAdmin);
router.put("/markup", authenticateSuperAdmin, upsertMarkup);

export default router;
