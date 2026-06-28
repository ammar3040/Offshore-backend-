import { Router } from "express";
import {
  addCrewAvailability,
  deleteCrewAvailabilityHandler,
  getCrewAvailabilities,
  updateCrewAvailabilityHandler,
} from "../controllers/crewAvailability.controller";
import { authenticateAdminOrCrew, authenticateCrew } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  availabilityIdParamSchema,
  createAvailabilitySchema,
  getAvailabilityQuerySchema,
  updateAvailabilitySchema,
} from "../validations/crewAvailability.validation";

const router = Router();

// GET - accessible by both admin and crew
// Crew: returns own availabilities (crew_id from token)
// Admin: requires crew_id query param
router.get(
  "/",
  authenticateAdminOrCrew,
  validate(getAvailabilityQuerySchema, "query"),
  getCrewAvailabilities
);

// POST - admin or crew
router.post(
  "/",
  authenticateAdminOrCrew,
  validate(createAvailabilitySchema),
  addCrewAvailability
);

// PATCH - admin or crew
router.patch(
  "/:availability_id",
  authenticateAdminOrCrew,
  validate(availabilityIdParamSchema, "params"),
  validate(updateAvailabilitySchema),
  updateCrewAvailabilityHandler
);

// DELETE - admin or crew
router.delete(
  "/:availability_id",
  authenticateAdminOrCrew,
  validate(availabilityIdParamSchema, "params"),
  deleteCrewAvailabilityHandler
);

export default router;
