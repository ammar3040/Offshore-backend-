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

// POST - crew only
router.post(
  "/",
  authenticateCrew,
  validate(createAvailabilitySchema),
  addCrewAvailability
);

// PATCH - crew only
router.patch(
  "/:availability_id",
  authenticateCrew,
  validate(availabilityIdParamSchema, "params"),
  validate(updateAvailabilitySchema),
  updateCrewAvailabilityHandler
);

// DELETE - crew only
router.delete(
  "/:availability_id",
  authenticateCrew,
  validate(availabilityIdParamSchema, "params"),
  deleteCrewAvailabilityHandler
);

export default router;
