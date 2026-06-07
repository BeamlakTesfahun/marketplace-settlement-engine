import express from "express";

import { protect } from "../../middlewares/authMiddleware.js";
import { authorizeRoles } from "../../middlewares/roleMiddleware.js";
import { validateRequest } from "../../middlewares/validateRequest.js";

import { refundController } from "./refund.controller.js";

import {
  orderIdParamSchema,
  requestRefundSchema,
  rejectRefundSchema,
} from "./refund.validation.js";

const router = express.Router();

router.use(protect);

router.post(
  "/:orderId/request",
  authorizeRoles("CUSTOMER"),
  validateRequest(requestRefundSchema),
  refundController.requestRefund,
);

router.patch(
  "/:orderId/approve",
  authorizeRoles("ADMIN"),
  validateRequest(orderIdParamSchema),
  refundController.approveRefund,
);

router.patch(
  "/:orderId/reject",
  authorizeRoles("ADMIN"),
  validateRequest(rejectRefundSchema),
  refundController.rejectRefund,
);

router.get(
  "/my-requests",
  authorizeRoles("CUSTOMER"),
  refundController.getMyRefundRequests,
);

router.get("/", authorizeRoles("ADMIN"), refundController.getAllRefundRequests);

export default router;
