import { Router } from "express";
import {
  deleteProjectHandler,
  getProjectById,
  getProjectCrew,
  getProjects,
  patchProject,
  postProject,
} from "../controllers";
import { authenticateAdmin, authenticateAdminOrSuperAdmin } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  createProjectSchema,
  projectIdParamSchema,
  updateProjectSchema,
} from "../validations/project.validation";

const router = Router();

router.get("/", authenticateAdminOrSuperAdmin, getProjects);
router.get("/:id/crew", authenticateAdminOrSuperAdmin, validate(projectIdParamSchema, "params"), getProjectCrew);
router.get("/:id", authenticateAdminOrSuperAdmin, validate(projectIdParamSchema, "params"), getProjectById);
router.post("/", authenticateAdmin, validate(createProjectSchema), postProject);
router.patch(
  "/:id",
  authenticateAdmin,
  validate(projectIdParamSchema, "params"),
  validate(updateProjectSchema),
  patchProject
);
router.delete("/:id", authenticateAdmin, validate(projectIdParamSchema, "params"), deleteProjectHandler);

export default router;
