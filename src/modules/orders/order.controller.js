import { asyncHandler } from '../../middlewares/asyncHandler.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { orderService } from './order.service.js';

const checkout = asyncHandler(async (req, res) => {
    const result = await orderService.checkout(req.user);

    return sendResponse(res, 201, 'Order placed successfully.', result);
});

const getMyOrders = asyncHandler(async (req, res) => {
    const result = await orderService.getMyOrders(req.user);

    return sendResponse(res, 200, 'Orders fetched successfully.', result);
});

const getOrderById = asyncHandler(async (req, res) => {
    const result = await orderService.getOrderById(
        req.user,
        req.params.orderId,
    );

    return sendResponse(res, 200, 'Order fetched successfully.', result);
});

const getVendorOrders = asyncHandler(async (req, res) => {
    const result = await orderService.getVendorOrders(req.user);

    return sendResponse(
        res,
        200,
        'Vendor orders fetched successfully.',
        result,
    );
});

const cancelOrder = asyncHandler(async (req, res) => {
    const result = await orderService.cancelOrder(req.user, req.params.orderId);

    return sendResponse(res, 200, 'Order cancelled successfully.', result);
});

const markOrderAsDelivered = asyncHandler(async (req, res) => {
    const result = await orderService.markOrderAsDelivered(
        req.user,
        req.params.orderId,
    );

    return sendResponse(
        res,
        200,
        'Order marked as delivered successfully.',
        result,
    );
});

const getOrderStatusHistory = asyncHandler(async (req, res) => {
    const result = await orderService.getOrderStatusHistory(
        req.user,
        req.params.orderId,
    );

    return sendResponse(
        res,
        200,
        'Order status history fetched successfully.',
        result,
    );
});

export const orderController = {
    checkout,
    getMyOrders,
    getOrderById,
    getVendorOrders,
    cancelOrder,
    markOrderAsDelivered,
    getOrderStatusHistory,
};
