import express from "express";

import { authController } from "./auth.controller.js";
import { validateRequest } from "../../middlewares/validateRequest.js";
import { protect } from "../../middlewares/authMiddleware.js";
import { registerSchema, loginSchema } from "./auth.validation.js";
import { authRateLimiter } from "../../middlewares/rateLimiter.js";

const router = express.Router();

router.post(
  "/register",
  authRateLimiter,
  validateRequest(registerSchema),
  authController.register,
);

router.post(
  "/login",
  authRateLimiter,
  validateRequest(loginSchema),
  authController.login,
);

router.get("/me", protect, authController.getMe);

export default router;
