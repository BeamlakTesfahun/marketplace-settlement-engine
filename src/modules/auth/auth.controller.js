import { asyncHandler } from "../../middlewares/asyncHandler.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { authService } from "./auth.service.js";

const register = asyncHandler(async (req, res) => {
  const result = await authService.registerUser(req.validatedData.body);

  return sendResponse(res, 201, "User registered successfully.", result);
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.loginUser(req.validatedData.body);

  return sendResponse(res, 200, "User logged in successfully.", result);
});

const getMe = asyncHandler(async (req, res) => {
  const result = await authService.getMe(req.user);

  return sendResponse(res, 200, "Profile fetched successfully.", result);
});

export const authController = {
  register,
  login,
  getMe,
};
