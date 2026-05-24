import Joi from "joi";

const objectId = Joi.string()
  .regex(/^[0-9a-fA-F]{24}$/)
  .message("must be a valid ObjectId");

export const createRigSchema = Joi.object({
  name: Joi.string().required().trim().messages({
    "string.empty": "name is required",
    "any.required": "name is required",
  }),
  address: Joi.string().required().trim().messages({
    "string.empty": "address is required",
    "any.required": "address is required",
  }),
  description: Joi.string().trim().optional(),
});

export const updateRigSchema = Joi.object({
  name: Joi.string().trim().optional(),
  description: Joi.string().trim().optional(),
})
  .min(1)
  .messages({
    "object.min": "At least one field is required for update",
  });

export const rigIdParamSchema = Joi.object({
  id: objectId.required().messages({
    "any.required": "Rig id is required",
  }),
});
