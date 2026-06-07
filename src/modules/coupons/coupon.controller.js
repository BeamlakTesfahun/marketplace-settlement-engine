import { asyncHandler } from "../../middlewares/asyncHandler.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { couponService } from "./coupon.service.js";

const createCoupon = asyncHandler(async (req, res) => {
  const result = await couponService.createCoupon(
    req.user,
    req.validatedData.body,
  );

  return sendResponse(res, 201, "Coupon created successfully.", result);
});

const getCoupons = asyncHandler(async (req, res) => {
  const result = await couponService.getCoupons(req.user);

  return sendResponse(res, 200, "Coupons fetched successfully.", result);
});

const deactivateCoupon = asyncHandler(async (req, res) => {
  const result = await couponService.deactivateCoupon(
    req.user,
    req.params.couponId,
  );

  return sendResponse(res, 200, "Coupon deactivated successfully.", result);
});

const getCouponById = asyncHandler(async (req, res) => {
  const result = await couponService.getCouponById(
    req.user,
    req.params.couponId,
  );

  return sendResponse(res, 200, "Coupon fetched successfully.", result);
});

const updateCoupon = asyncHandler(async (req, res) => {
  const result = await couponService.updateCoupon(
    req.user,
    req.params.couponId,
    req.validatedData.body,
  );

  return sendResponse(res, 200, "Coupon updated successfully.", result);
});

export const couponController = {
  createCoupon,
  getCoupons,
  deactivateCoupon,
  getCouponById,
  updateCoupon,
};
