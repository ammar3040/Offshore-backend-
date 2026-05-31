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
  price: Joi.number().min(0).default(0),
  cashback: Joi.number().min(0).default(0),
  rig_id: objectId.optional(),
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
  price: Joi.number().min(0).optional(),
  cashback: Joi.number().min(0).optional(),
  rig_id: objectId.optional(),
}).min(1).messages({
  "object.min": "At least one field is required for update",
});

export const approveCrewTicketSchema = Joi.object({
  bookingReference: Joi.string().trim().min(1).max(64).required().messages({
    "any.required": "bookingReference is required",
    "string.empty": "bookingReference is required",
  }),
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

/** Time format HH:mm, date format YYYY-MM-DD */
const timePattern = /^\d{2}:\d{2}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

/** For POST /search-flights - pagination params + time filters */
export const searchFlightsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sortBy: Joi.string().valid("price", "duration", "stops", "departureTime", "arrivalTime").optional(),
  sortOrder: Joi.string().valid("asc", "desc").default("asc"),
  /** Non-stop only: sets Riya chkNonStop and filters results to aggregated stops === 0. */
  directOnly: Joi.boolean().optional(),
  departureTime: Joi.string().pattern(timePattern).optional().messages({
    "string.pattern.base": "departureTime must be HH:mm (e.g. 10:30)",
  }),
  arrivalDate: Joi.string().pattern(datePattern).optional().messages({
    "string.pattern.base": "arrivalDate must be YYYY-MM-DD",
  }),
  arrivalTime: Joi.string().pattern(timePattern).optional().messages({
    "string.pattern.base": "arrivalTime must be HH:mm (e.g. 18:45)",
  }),
}).unknown(true);

/** For POST /book - pass selected flight from search response (Option 1) */
export const bookFlightSchema = Joi.object({
  project_id: objectId.required().messages({
    "any.required": "project_id is required",
  }),
  crew_ids: Joi.array().items(objectId).min(1).required().messages({
    "any.required": "crew_ids is required",
    "array.min": "At least one crew_id is required",
  }),
  flight: Joi.object({
    id: Joi.string().required().messages({
      "any.required": "flight.id is required",
    }),
    legs: Joi.array()
      .items(
        Joi.object({
          itinerary: Joi.array()
            .items(
              Joi.object({
                fromAirport: Joi.string().optional(),
                toAirport: Joi.string().optional(),
              }).unknown(true)
            )
            .optional(),
        })
        .unknown(true)
      )
      .min(1)
      .required()
      .messages({
        "any.required": "flight.legs from search response is required",
      }),
    fares: Joi.array()
      .items(Joi.object({ cabin: Joi.string().optional() }).unknown(true))
      .optional(),
  })
  .unknown(true)
  .required()
  .messages({
    "any.required": "flight object from search response is required",
  }),
  adult: Joi.number().integer().min(0).default(1),
  children: Joi.number().integer().min(0).default(0),
  infants: Joi.number().integer().min(0).default(0),
  cashback: Joi.number().min(0).default(0),
  price: Joi.number().min(0).default(0),
  /** Currency of price, cashback (e.g. from search). Default GBP. */
  currency: Joi.string().trim().length(3).default("GBP"),
});
