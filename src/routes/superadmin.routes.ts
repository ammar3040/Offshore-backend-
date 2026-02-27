import { Router } from "express";
import { loginSuperAdmin, createAdminBySuperAdmin, getAllAdmins } from "../controllers";
import { authenticateSuperAdmin } from "../middleware/auth";

const router = Router();

router.post("/login", loginSuperAdmin);
router.get("/admins", authenticateSuperAdmin, getAllAdmins);
router.post("/admins", authenticateSuperAdmin, createAdminBySuperAdmin);

export default router;
