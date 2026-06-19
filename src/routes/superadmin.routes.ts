import { Router } from "express";
import {
  createAdminBySuperAdmin,
  getAllAdmins,
  getAnalytics,
  listAdminInvoices,
  loginSuperAdmin,
  sendAdminInvoice,
  streamSuperadminInvoicePdf,
  uploadAdminInvoicePdf,
  upsertMarkup,
  upsertMarkupPercentage,
} from "../controllers";
import { authenticateSuperAdmin } from "../middleware/auth";
import { adminInvoicePdfUpload } from "../middleware/upload";
import { uploadAdminInvoicePdfToCloudinary } from "../middleware/cloudinaryUpload";

const router = Router();

router.post("/login", loginSuperAdmin);
router.get("/analytics", authenticateSuperAdmin, getAnalytics);
router.get("/admins", authenticateSuperAdmin, getAllAdmins);
router.post("/admins", authenticateSuperAdmin, createAdminBySuperAdmin);
router.put("/markup", authenticateSuperAdmin, upsertMarkup);
router.put("/markup_percentage", authenticateSuperAdmin, upsertMarkupPercentage);

router.get("/admin-invoices", authenticateSuperAdmin, listAdminInvoices);
router.get("/admin-invoice/:ticketId/pdf", authenticateSuperAdmin, streamSuperadminInvoicePdf);
router.post(
  "/admin-invoice/:ticketId/upload",
  authenticateSuperAdmin,
  adminInvoicePdfUpload,
  uploadAdminInvoicePdfToCloudinary,
  uploadAdminInvoicePdf
);
router.post("/admin-invoice/:ticketId/send", authenticateSuperAdmin, sendAdminInvoice);

export default router;
