import { ZodError } from "zod";
import { AppError } from "../utils/AppError.js";

export const validateRequest = (schema) => {
  return (req, res, next) => {
    try {
      req.validatedData = schema.parse({
        body: req.body ?? {},
        params: req.params ?? {},
        query: req.query ?? {},
      });

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return next(
          new AppError("Validation failed.", 400, "VALIDATION_ERROR", {
            fieldErrors: error.flatten().fieldErrors,
            formErrors: error.flatten().formErrors,
          }),
        );
      }

      next(error);
    }
  };
};
