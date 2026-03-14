import Joi from "joi";

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/).message("must be a valid ObjectId");

export const crewIdParamSchema = Joi.object({
  crew_id: objectId.required().messages({
    "any.required": "crew_id is required",
  }),
});

export const crewAndProjectParamsSchema = Joi.object({
  crew_id: objectId.required().messages({
    "any.required": "crew_id is required",
  }),
  project_id: objectId.required().messages({
    "any.required": "project_id is required",
  }),
});

export const crewAndTicketParamsSchema = Joi.object({
  crew_id: objectId.required().messages({
    "any.required": "crew_id is required",
  }),
  ticket_id: objectId.required().messages({
    "any.required": "ticket_id is required",
  }),
});
