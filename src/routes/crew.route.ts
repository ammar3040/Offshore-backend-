import { Router } from "express";
import {
  deleteCrewHandler,
  deleteCrewTicketByCrewHandler,
  getCrew,
  getCrewAvailableForProject,
  getCrewById,
  getCrewMe,
  loginCrew,
  patchCrew,
  postCrew,
  postCrewCloudinarySign,
  resetCrewPassword,
  unassignCrewFromProject,
} from "../controllers";
import { authenticateAdmin, authenticateAdminOrSuperAdmin, authenticateCrew, authenticateSuperAdmin } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { crewUpload } from "../middleware/upload";
import {
  uploadCrewFilesToCloudinary,
  uploadCrewFilesToCloudinaryOptional,
} from "../middleware/cloudinaryUpload";
import { applyCrewDocumentUrlsFromBody } from "../middleware/crewDocumentUrls";
import { projectIdParamSchema } from "../validations/crewInvite.validation";
import {
  crewAndProjectParamsSchema,
  crewAndTicketParamsSchema,
  crewIdParamSchema,
  getCrewQuerySchema,
} from "../validations/crew.validation";

const router = Router();

// crew management
router.get("/", authenticateAdminOrSuperAdmin, validate(getCrewQuerySchema, "query"), getCrew);
router.get(
  "/project/:project_id/available",
  authenticateAdminOrSuperAdmin,
  validate(projectIdParamSchema, "params"),
  getCrewAvailableForProject
);
router.get("/me", authenticateCrew, getCrewMe);
router.post("/login", loginCrew);
router.patch("/reset-password", authenticateCrew, resetCrewPassword);

/** Signed params for browser → Cloudinary direct upload (avoids Vercel 4.5MB body limit / 413). */
router.post("/cloudinary-sign", authenticateAdminOrSuperAdmin, postCrewCloudinarySign);

router.get(
  "/:crew_id",
  authenticateAdminOrSuperAdmin,
  validate(crewIdParamSchema, "params"),
  getCrewById
);

// create crew
router.post(
  "/",
  authenticateAdmin,
  crewUpload,
  applyCrewDocumentUrlsFromBody,
  uploadCrewFilesToCloudinary,
  postCrew
);

// update crew (supports multipart/form-data like create, or JSON)
router.patch(
  "/:crew_id",
  authenticateAdminOrSuperAdmin,
  validate(crewIdParamSchema, "params"),
  crewUpload,
  applyCrewDocumentUrlsFromBody,
  uploadCrewFilesToCloudinaryOptional,
  patchCrew
);

// unassign/remove crew from project (must precede delete crew for route specificity)
router.delete(
  "/:crew_id/project/:project_id",
  authenticateAdminOrSuperAdmin,
  validate(crewAndProjectParamsSchema, "params"),
  unassignCrewFromProject
);

// delete crew ticket - superadmin only (validates ticket belongs to crew)
router.delete(
  "/:crew_id/ticket/:ticket_id",
  authenticateSuperAdmin,
  validate(crewAndTicketParamsSchema, "params"),
  deleteCrewTicketByCrewHandler
);

// delete crew (returns 409 with projects list if crew is assigned - frontend shows popup)
router.delete(
  "/:crew_id",
  authenticateAdminOrSuperAdmin,
  validate(crewIdParamSchema, "params"),
  deleteCrewHandler
);

export default router;
