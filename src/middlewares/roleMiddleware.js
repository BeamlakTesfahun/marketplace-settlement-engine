import { AppError } from "../utils/AppError.js";

export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(
        new AppError("Authentication required.", 401, "UNAUTHORIZED"),
      );
    }

    if (!roles.includes(req.user.role)) {
      return next(
        new AppError(
          "You are not authorized to access this resource.",
          403,
          "FORBIDDEN",
        ),
      );
    }

    next();
  };
};
