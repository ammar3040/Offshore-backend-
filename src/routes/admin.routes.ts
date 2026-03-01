import { Router } from "express";
import { getAdminMe, loginAdmin } from "../controllers";
import { authenticateAdmin } from "../middleware/auth";

const router = Router();

router.post("/login", loginAdmin);
router.get("/me", authenticateAdmin, getAdminMe);

export default router;

