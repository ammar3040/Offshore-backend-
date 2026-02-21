import Joi from "joi";
import { CabinClass, TripType } from "../models/crewTicket.model";

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/).message("must be a valid ObjectId");

const airportLocationSchema = Joi.object({
  Name: Joi.string().required().trim(),
  COUNTRY: Joi.string().required().trim(),
  COUNTRYNAME: Joi.string().required().trim(),
});

export const createCrewTicketSchema = Joi.object({
  crew_id: objectId.required().messages({
    "any.required": "crew_id is required",
  }),
  project_id: objectId.required().messages({
    "any.required": "project_id is required",
  }),
  from: airportLocationSchema.required(),
  to: airportLocationSchema.required(),
  class: Joi.string()
    .valid(...Object.values(CabinClass))
    .required()
    .messages({
      "any.required": "class is required",
    }),
  adult: Joi.number().integer().min(0).required().messages({
    "any.required": "adult is required",
  }),
  children: Joi.number().integer().min(0).default(0),
  infants: Joi.number().integer().min(0).default(0),
  trip: Joi.string()
    .valid(...Object.values(TripType))
    .required()
    .messages({
      "any.required": "trip is required",
    }),
});

export const updateCrewTicketSchema = Joi.object({
  from: airportLocationSchema.optional(),
  to: airportLocationSchema.optional(),
  class: Joi.string()
    .valid(...Object.values(CabinClass))
    .optional(),
  adult: Joi.number().integer().min(0).optional(),
  children: Joi.number().integer().min(0).optional(),
  infants: Joi.number().integer().min(0).optional(),
  trip: Joi.string()
    .valid(...Object.values(TripType))
    .optional(),
}).min(1).messages({
  "object.min": "At least one field is required for update",
});

export const crewTicketIdParamSchema = Joi.object({
  id: objectId.required().messages({
    "any.required": "Crew ticket id is required",
  }),
});

/** For routes where :id represents crew_id (e.g. GET /crew-ticket/crew/:id) */
export const crewIdParamSchema = Joi.object({
  id: objectId.required().messages({
    "any.required": "Crew id is required",
  }),
});
