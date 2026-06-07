import Joi from "joi";

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/).message("must be a valid ObjectId");

export const projectIdParamSchema = Joi.object({
  project_id: objectId.required().messages({
    "any.required": "project_id is required",
  }),
});

export const inviteCrewSchema = Joi.object({
  crew_ids: Joi.array().items(objectId).min(1).required().messages({
    "array.min": "At least one crew_id is required",
    "any.required": "crew_ids is required",
  }),
  contract_body: Joi.string().allow("").optional(),
  contract_title: Joi.string().allow("").optional(),
});

export const acceptInviteSchema = Joi.object({
  terms_agreed: Joi.boolean().valid(true).optional(),
});
