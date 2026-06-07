import express from "express";

import { cartController } from "./cart.controller.js";
import { protect } from "../../middlewares/authMiddleware.js";
import { validateRequest } from "../../middlewares/validateRequest.js";

import {
  addCartItemSchema,
  updateCartItemSchema,
  cartItemParamsSchema,
} from "./cart.validation.js";

const router = express.Router();

router.use(protect);

router.post(
  "/items",
  validateRequest(addCartItemSchema),
  cartController.addItemToCart,
);

router.get("/", cartController.getMyCart);

router.patch(
  "/items/:cartItemId",
  validateRequest(updateCartItemSchema),
  cartController.updateCartItem,
);

router.delete(
  "/items/:cartItemId",
  validateRequest(cartItemParamsSchema),
  cartController.removeCartItem,
);

router.delete("/", cartController.clearMyCart);

export default router;
