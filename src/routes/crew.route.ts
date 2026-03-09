import { Router } from "express";
import {
  deleteCrewHandler,
  getCrew,
  getCrewAvailableForProject,
  getCrewById,
  getCrewMe,
  loginCrew,
  patchCrew,
  postCrew,
  resetCrewPassword,
  unassignCrewFromProject,
} from "../controllers";
import { authenticateAdminOrSuperAdmin, authenticateCrew } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { crewUpload } from "../middleware/upload";
import {
  uploadCrewFilesToCloudinary,
  uploadCrewFilesToCloudinaryOptional,
} from "../middleware/cloudinaryUpload";
import { projectIdParamSchema } from "../validations/crewInvite.validation";
import {
  crewAndProjectParamsSchema,
  crewIdParamSchema,
} from "../validations/crew.validation";

const router = Router();

// crew management
router.get("/", authenticateAdminOrSuperAdmin, getCrew);
router.get(
  "/project/:project_id/available",
  authenticateAdminOrSuperAdmin,
  validate(projectIdParamSchema, "params"),
  getCrewAvailableForProject
);
router.get("/me", authenticateCrew, getCrewMe);
router.get(
  "/:crew_id",
  authenticateAdminOrSuperAdmin,
  validate(crewIdParamSchema, "params"),
  getCrewById
);
router.post("/login", loginCrew);
router.patch("/reset-password", authenticateCrew, resetCrewPassword);

// create crew
router.post("/", crewUpload, uploadCrewFilesToCloudinary, postCrew);

// update crew (supports multipart/form-data like create, or JSON)
router.patch(
  "/:crew_id",
  authenticateAdminOrSuperAdmin,
  validate(crewIdParamSchema, "params"),
  crewUpload,
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

// delete crew (returns 409 with projects list if crew is assigned - frontend shows popup)
router.delete(
  "/:crew_id",
  authenticateAdminOrSuperAdmin,
  validate(crewIdParamSchema, "params"),
  deleteCrewHandler
);

export default router;
