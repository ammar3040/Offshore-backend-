import Joi from "joi";
import { EMPLOYER_VALUES } from "../constants/employers";

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/).message("must be a valid ObjectId");

const assignmentFieldsSchema = {
  employer: Joi.string()
    .valid(...EMPLOYER_VALUES)
    .optional(),
  employer_other: Joi.string().trim().max(200).optional().allow(""),
  client: Joi.string().trim().max(200).optional().allow(""),
  rig_vessel: Joi.string().trim().max(200).optional().allow(""),
  country: Joi.string().trim().max(100).optional().allow(""),
  notes: Joi.string().trim().max(1000).optional().allow(""),
};

export const availabilityIdParamSchema = Joi.object({
  availability_id: objectId.required().messages({
    "any.required": "availability_id is required",
  }),
});

export const createAvailabilitySchema = Joi.object({
  crew_id: objectId.optional(),
  from: Joi.date().required().messages({
    "any.required": "from date is required",
    "date.base": "from must be a valid date",
  }),
  to: Joi.date().min(Joi.ref("from")).required().messages({
    "any.required": "to date is required",
    "date.base": "to must be a valid date",
    "date.min": "to must be on or after from",
  }),
  isAvailable: Joi.boolean().optional().default(true),
  ...assignmentFieldsSchema,
});

export const updateAvailabilitySchema = Joi.object({
  from: Joi.date().optional(),
  to: Joi.date().optional(),
  isAvailable: Joi.boolean().optional(),
  ...assignmentFieldsSchema,
})
  .min(1)
  .messages({
    "object.min": "At least one field is required",
  });

export const getAvailabilityQuerySchema = Joi.object({
  crew_id: objectId.optional(),
});
