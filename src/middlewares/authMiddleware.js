import jwt from "jsonwebtoken";

import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";

import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "./asyncHandler.js";

export const protect = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AppError("Access token is required.", 401, "UNAUTHORIZED");
  }

  const token = authHeader.split(" ")[1];

  if (!token || token === "undefined" || token === "null") {
    throw new AppError("Access token is required.", 401, "UNAUTHORIZED");
  }

  let decoded;

  try {
    decoded = jwt.verify(token, env.jwtSecret);
  } catch {
    throw new AppError("Invalid or expired token.", 401, "UNAUTHORIZED");
  }

  const user = await prisma.user.findUnique({
    where: {
      id: decoded.userId,
    },

    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new AppError(
      "User associated with this token no longer exists.",
      401,
      "UNAUTHORIZED",
    );
  }

  req.user = user;

  next();
});
