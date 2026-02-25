import { Router } from "express";
import { loginSuperAdmin, createAdminBySuperAdmin } from "../controllers";
import { authenticateSuperAdmin } from "../middleware/auth";

const router = Router();

router.post("/login", loginSuperAdmin);
router.post("/admins", authenticateSuperAdmin, createAdminBySuperAdmin);

export default router;
