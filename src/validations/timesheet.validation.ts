import Joi from "joi";
import { AttendanceStatus } from "../models/timesheet.model";

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/).message("must be a valid ObjectId");

export const timesheetIdParamSchema = Joi.object({
  id: objectId.required().messages({
    "any.required": "Timesheet id is required",
  }),
});

export const crewProjectParamsSchema = Joi.object({
  project_id: objectId.required().messages({
    "any.required": "project_id is required",
  }),
});

export const updateEntryStatusSchema = Joi.object({
  date: Joi.date().required().messages({
    "date.base": "date must be a valid date",
    "any.required": "date is required",
  }),
  status: Joi.string()
    .valid(AttendanceStatus.Present, AttendanceStatus.Leave, AttendanceStatus.Absent)
    .required()
    .messages({
      "any.only": "status must be PRESENT, LEAVE, or ABSENT",
      "any.required": "status is required",
    }),
});
