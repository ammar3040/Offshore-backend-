import { Router } from "express";
import { getAdminMe, listAdminPanelInvoices, loginAdmin } from "../controllers";
import { authenticateAdmin } from "../middleware/auth";

const router = Router();

router.post("/login", loginAdmin);
router.get("/me", authenticateAdmin, getAdminMe);
router.get("/admin-invoices", authenticateAdmin, listAdminPanelInvoices);

export default router;

