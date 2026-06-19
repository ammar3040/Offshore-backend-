import Joi from "joi";
import { ProjectStatus } from "../models/project.model";

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/).message("must be a valid ObjectId");

const durationSchema = Joi.object({
  startDate: Joi.date().required().messages({
    "date.base": "startDate must be a valid date",
    "any.required": "startDate is required",
  }),
  endDate: Joi.date().greater(Joi.ref("startDate")).required().messages({
    "date.base": "endDate must be a valid date",
    "date.greater": "endDate must be after startDate",
    "any.required": "endDate is required",
  }),
});

export const createProjectSchema = Joi.object({
  title: Joi.string().required().trim().messages({
    "string.empty": "title is required",
    "any.required": "title is required",
  }),
  description: Joi.string().required().trim().messages({
    "string.empty": "description is required",
    "any.required": "description is required",
  }),
  duration: durationSchema.required().messages({
    "any.required": "duration with startDate and endDate is required",
  }),
  span: Joi.string().required().trim().messages({
    "string.empty": "span is required",
    "any.required": "span is required",
  }),
  participants: Joi.array().items(objectId).default([]),
  rig_id: objectId.optional(),
  status: Joi.string()
    .valid(...Object.values(ProjectStatus))
    .default(ProjectStatus.Active),
});

export const updateProjectSchema = Joi.object({
  title: Joi.string().trim().optional(),
  description: Joi.string().trim().optional(),
  duration: durationSchema.optional(),
  span: Joi.string().trim().optional(),
  createdBy: objectId.optional(),
  participants: Joi.array().items(objectId).optional(),
  rig_id: objectId.optional().allow(null, ""),
  status: Joi.string()
    .valid(...Object.values(ProjectStatus))
    .optional(),
}).min(1).messages({
  "object.min": "At least one field is required for update",
});

export const projectIdParamSchema = Joi.object({
  id: objectId.required().messages({
    "any.required": "Project id is required",
  }),
});
