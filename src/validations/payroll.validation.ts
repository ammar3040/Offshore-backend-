import Joi from "joi";
import { PayrollRateType } from "../models/payroll.model";

const objectId = Joi.string()
  .regex(/^[0-9a-fA-F]{24}$/)
  .message("must be a valid ObjectId");

export const upsertPayrollSchema = Joi.object({
  crew_id: objectId.required().messages({
    "any.required": "crew_id is required",
  }),
  project_id: objectId.required().messages({
    "any.required": "project_id is required",
  }),
  rate_type: Joi.string()
    .valid(...Object.values(PayrollRateType))
    .required()
    .messages({
      "any.required": "rate_type is required",
      "any.only": "rate_type must be per_hour, per_day, or per_project",
    }),
  pay_amount: Joi.number().min(0).required().messages({
    "any.required": "pay_amount is required",
    "number.min": "pay_amount must be zero or greater",
  }),
});

export const payrollIdParamSchema = Joi.object({
  id: objectId.required().messages({
    "any.required": "Payroll id is required",
  }),
});
