import { Router } from "express";
import { acceptInvite, getMyEnrolledProjects, getMyPendingInvites, inviteCrewToProject } from "../controllers";
import { authenticateAdmin, authenticateCrew } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  inviteCrewSchema,
  projectIdParamSchema,
} from "../validations/crewInvite.validation";

const router = Router();

router.get("/me/pending", authenticateCrew, getMyPendingInvites);
router.get("/me/enrolled", authenticateCrew, getMyEnrolledProjects);

router.post(
  "/project/:project_id",
  authenticateAdmin,
  validate(projectIdParamSchema, "params"),
  validate(inviteCrewSchema),
  inviteCrewToProject
);

router.patch(
  "/project/:project_id/accept",
  authenticateCrew,
  validate(projectIdParamSchema, "params"),
  acceptInvite
);

export default router;
