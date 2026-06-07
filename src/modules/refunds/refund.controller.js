import { asyncHandler } from "../../middlewares/asyncHandler.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { refundService } from "./refund.service.js";

const requestRefund = asyncHandler(async (req, res) => {
  const result = await refundService.requestRefund(
    req.user,
    req.params.orderId,
    req.validatedData.body,
  );

  return sendResponse(res, 200, "Refund requested successfully.", result);
});

const approveRefund = asyncHandler(async (req, res) => {
  const result = await refundService.approveRefund(
    req.user,
    req.params.orderId,
  );

  return sendResponse(
    res,
    200,
    "Refund approved and processed successfully.",
    result,
  );
});

const rejectRefund = asyncHandler(async (req, res) => {
  const result = await refundService.rejectRefund(req.user, req.params.orderId);

  return sendResponse(res, 200, "Refund rejected successfully.", result);
});

const getMyRefundRequests = asyncHandler(async (req, res) => {
  const result = await refundService.getMyRefundRequests(req.user);

  return sendResponse(
    res,
    200,
    "Refund requests fetched successfully.",
    result,
  );
});

const getAllRefundRequests = asyncHandler(async (req, res) => {
  const result = await refundService.getAllRefundRequests(req.user);

  return sendResponse(
    res,
    200,
    "All refund requests fetched successfully.",
    result,
  );
});

export const refundController = {
  requestRefund,
  approveRefund,
  rejectRefund,
  getMyRefundRequests,
  getAllRefundRequests,
};
