import { Router } from "express";
import {
  getMyTimesheets,
  getTimesheetByCrewAndProject,
  getTimesheetById,
  getTimesheetsByProject,
  patchTimesheetEntryStatus,
} from "../controllers/timesheet.controller";
import { authenticateAdmin, authenticateCrew } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  crewProjectParamsSchema,
  timesheetIdParamSchema,
  updateEntryStatusSchema,
} from "../validations/timesheet.validation";

const router = Router();

// Crew: get my timesheets
router.get("/me", authenticateCrew, getMyTimesheets);

// Crew: get my timesheet for a specific project
router.get(
  "/me/project/:project_id",
  authenticateCrew,
  validate(crewProjectParamsSchema, "params"),
  getTimesheetByCrewAndProject
);

// Crew: update attendance status (LEAVE or ABSENT) for a specific day
router.patch(
  "/me/project/:project_id/entry",
  authenticateCrew,
  validate(crewProjectParamsSchema, "params"),
  validate(updateEntryStatusSchema),
  patchTimesheetEntryStatus
);

// Admin: get timesheet by id
router.get(
  "/:id",
  authenticateAdmin,
  validate(timesheetIdParamSchema, "params"),
  getTimesheetById
);

// Admin: get all timesheets for a project
router.get(
  "/project/:project_id/all",
  authenticateAdmin,
  validate(crewProjectParamsSchema, "params"),
  getTimesheetsByProject
);

export default router;
