import { Router } from "express";
import { getAdminMe, listAdminPanelInvoices, loginAdmin, streamAdminPanelInvoicePdf } from "../controllers";
import { authenticateAdmin } from "../middleware/auth";

const router = Router();

router.post("/login", loginAdmin);
router.get("/me", authenticateAdmin, getAdminMe);
router.get("/admin-invoices", authenticateAdmin, listAdminPanelInvoices);
router.get("/admin-invoice/:projectId/pdf", authenticateAdmin, streamAdminPanelInvoicePdf);

export default router;

