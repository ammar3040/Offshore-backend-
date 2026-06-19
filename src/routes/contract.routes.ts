import { Router } from "express";
import { getSignedContracts } from "../controllers";
import { authenticateAdminOrSuperAdmin } from "../middleware/auth";

const router = Router();

router.get("/signed", authenticateAdminOrSuperAdmin, getSignedContracts);

export default router;
