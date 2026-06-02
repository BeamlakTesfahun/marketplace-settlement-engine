import { asyncHandler } from '../../middlewares/asyncHandler.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { payoutService } from './payout.service.js';

const getMyPayouts = asyncHandler(async (req, res) => {
    const result = await payoutService.getVendorPayouts(req.vendor.id);

    return sendResponse(
        res,
        200,
        'Vendor payouts fetched successfully.',
        result,
    );
});

const getAllPayouts = asyncHandler(async (req, res) => {
    const result = await payoutService.getAllPayouts(req.user);

    return sendResponse(res, 200, 'Payouts fetched successfully.', result);
});

const markPayoutAsPaid = asyncHandler(async (req, res) => {
    const result = await payoutService.markPayoutAsPaid(
        req.user,
        req.params.payoutId,
    );

    return sendResponse(
        res,
        200,
        'Payout marked as paid successfully.',
        result,
    );
});

const markPayoutAsFailed = asyncHandler(async (req, res) => {
    const result = await payoutService.markPayoutAsFailed(
        req.user,
        req.params.payoutId,
        req.validatedData.body.reason,
    );

    return sendResponse(
        res,
        200,
        'Payout marked as failed successfully.',
        result,
    );
});

const retryFailedPayout = asyncHandler(async (req, res) => {
    const result = await payoutService.retryFailedPayout(
        req.user,
        req.params.payoutId,
    );

    return sendResponse(res, 200, 'Payout retry started successfully.', result);
});

export const payoutController = {
    getMyPayouts,
    getAllPayouts,
    markPayoutAsPaid,
    markPayoutAsFailed,
    retryFailedPayout,
};
