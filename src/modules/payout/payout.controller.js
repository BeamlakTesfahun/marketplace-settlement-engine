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

export const payoutController = {
    getMyPayouts,
};
