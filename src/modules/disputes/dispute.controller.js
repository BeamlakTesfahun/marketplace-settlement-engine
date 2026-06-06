import { asyncHandler } from '../../middlewares/asyncHandler.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { disputeService } from './dispute.service.js';

const openDispute = asyncHandler(async (req, res) => {
    const result = await disputeService.openDispute(
        req.user,
        req.params.orderId,
        req.validatedData.body,
    );

    return sendResponse(res, 201, 'Dispute opened successfully.', result);
});

const respondToDispute = asyncHandler(async (req, res) => {
    const result = await disputeService.respondToDispute(
        req.user,
        req.params.orderId,
        req.validatedData.body,
    );

    return sendResponse(
        res,
        200,
        'Dispute response submitted successfully.',
        result,
    );
});

const resolveDispute = asyncHandler(async (req, res) => {
    const result = await disputeService.resolveDispute(
        req.user,
        req.params.orderId,
        req.params.vendorId,
        req.validatedData.body,
    );

    return sendResponse(res, 200, 'Dispute resolved successfully.', result);
});

export const disputeController = {
    openDispute,
    respondToDispute,
    resolveDispute,
};
