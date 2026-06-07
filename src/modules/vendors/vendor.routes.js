import express from "express";

import { vendorController } from "./vendor.controller.js";
import { protect } from "../../middlewares/authMiddleware.js";
import { validateRequest } from "../../middlewares/validateRequest.js";
import {
  createVendorProfileSchema,
  updateVendorStatusSchema,
} from "./vendor.validation.js";
import { authorizeRoles } from "../../middlewares/roleMiddleware.js";

const router = express.Router();

router.get("/", protect, authorizeRoles("ADMIN"), vendorController.getVendors);

router.post(
  "/me",
  protect,
  validateRequest(createVendorProfileSchema),
  vendorController.createVendorProfile,
);

router.get("/me", protect, vendorController.getMyVendorProfile);

router.patch(
  "/:vendorId/status",
  protect,
  authorizeRoles("ADMIN"),
  validateRequest(updateVendorStatusSchema),
  vendorController.updateVendorStatus,
);

export default router;
