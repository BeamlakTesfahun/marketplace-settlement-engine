import { z } from 'zod';

export const orderIdParamSchema = z.object({
    body: z.object({}),
    params: z.object({
        orderId: z.string().min(1, 'Order ID is required'),
    }),
    query: z.object({}),
});

export const openDisputeSchema = z.object({
    body: z.object({
        vendorId: z.string().trim().min(1, 'Vendor ID is required'),
        reason: z.string().trim().min(1, 'Dispute reason is required'),
    }),
    params: z.object({
        orderId: z.string().min(1, 'Order ID is required'),
    }),
    query: z.object({}),
});

export const respondToDisputeSchema = z.object({
    body: z.object({
        response: z.string().trim().min(1, 'Vendor response is required'),
    }),
    params: z.object({
        orderId: z.string().min(1, 'Order ID is required'),
    }),
    query: z.object({}),
});
