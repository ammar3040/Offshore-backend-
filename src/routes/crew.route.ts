import { Router } from "express";
import {
  getCrew,
  getCrewAvailableForProject,
  getCrewMe,
  loginCrew,
  postCrew,
  resetCrewPassword,
} from "../controllers";
import { authenticateAdminOrSuperAdmin, authenticateCrew } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { crewUpload } from "../middleware/upload";
import { uploadCrewFilesToCloudinary } from "../middleware/cloudinaryUpload";
import { projectIdParamSchema } from "../validations/crewInvite.validation";

const router = Router();

// crew management
router.get("/", authenticateAdminOrSuperAdmin, getCrew);
router.get("/project/:project_id/available", authenticateAdminOrSuperAdmin, validate(projectIdParamSchema, "params"), getCrewAvailableForProject);
router.get("/me", authenticateCrew, getCrewMe);
router.post("/login", loginCrew);
router.patch("/reset-password", authenticateCrew, resetCrewPassword);

// create crew
router.post("/", crewUpload, uploadCrewFilesToCloudinary, postCrew);

export default router;
