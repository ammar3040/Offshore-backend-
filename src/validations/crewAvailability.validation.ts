import Joi from "joi";

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/).message("must be a valid ObjectId");

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
});

export const updateAvailabilitySchema = Joi.object({
  from: Joi.date().optional(),
  to: Joi.date().optional(),
})
  .min(1)
  .messages({
    "object.min": "At least one of from or to is required",
  });

export const getAvailabilityQuerySchema = Joi.object({
  crew_id: objectId.optional(),
});
