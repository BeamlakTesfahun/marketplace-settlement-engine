import { asyncHandler } from "../../middlewares/asyncHandler.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { cartService } from "./cart.service.js";

const addItemToCart = asyncHandler(async (req, res) => {
  const result = await cartService.addItemToCart(
    req.user,
    req.validatedData.body,
  );

  return sendResponse(res, 201, "Item added to cart successfully.", result);
});

const getMyCart = asyncHandler(async (req, res) => {
  const result = await cartService.getMyCart(req.user);

  return sendResponse(res, 200, "Cart fetched successfully.", result);
});

const updateCartItem = asyncHandler(async (req, res) => {
  const result = await cartService.updateCartItem(
    req.user,
    req.params.cartItemId,
    req.validatedData.body,
  );

  return sendResponse(res, 200, "Cart item updated successfully.", result);
});

const removeCartItem = asyncHandler(async (req, res) => {
  await cartService.removeCartItem(req.user, req.params.cartItemId);

  return sendResponse(res, 200, "Cart item removed successfully.");
});

const clearMyCart = asyncHandler(async (req, res) => {
  await cartService.clearMyCart(req.user);

  return sendResponse(res, 200, "Cart cleared successfully.");
});

export const cartController = {
  addItemToCart,
  getMyCart,
  updateCartItem,
  removeCartItem,
  clearMyCart,
};
