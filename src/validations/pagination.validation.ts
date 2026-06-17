import Joi from "joi";

/** Shared optional page/limit query params — pagination applies only when `limit` is set. */
export const optionalPaginationQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).optional(),
});
