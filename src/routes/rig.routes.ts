import { Router } from "express";
import {
  deleteRigHandler,
  getRigById,
  getRigs,
  patchRig,
  postRig,
} from "../controllers";
import { authenticateAdmin, authenticateAdminOrSuperAdmin } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  createRigSchema,
  rigIdParamSchema,
  updateRigSchema,
} from "../validations/rig.validation";

const router = Router();

router.get("/", authenticateAdminOrSuperAdmin, getRigs);
router.get("/:id", authenticateAdminOrSuperAdmin, validate(rigIdParamSchema, "params"), getRigById);
router.post("/", authenticateAdmin, validate(createRigSchema), postRig);
router.patch(
  "/:id",
  authenticateAdmin,
  validate(rigIdParamSchema, "params"),
  validate(updateRigSchema),
  patchRig
);
router.delete("/:id", authenticateAdmin, validate(rigIdParamSchema, "params"), deleteRigHandler);

export default router;
