import { Request, Response, NextFunction } from "express";
import Joi from "joi";

type ValidationSource = "body" | "params" | "query";

export function validate(schema: Joi.Schema, source: ValidationSource = "body") {
  return (req: Request, res: Response, next: NextFunction) => {
    const data = req[source];
    const { error, value } = schema.validate(data, { abortEarly: false });

    if (error) {
      const message = error.details.map((d) => d.message).join("; ");
      return res.status(400).json({ message });
    }

    req[source] = value;
    next();
  };
}
