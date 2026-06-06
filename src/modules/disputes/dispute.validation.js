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

export const resolveDisputeSchema = z.object({
    body: z
        .object({
            resolution: z.enum([
                'REFUND',
                'PARTIAL_REFUND',
                'RELEASE_PAYOUT',
                'REJECT',
            ]),
            refundAmount: z.coerce.number().positive().optional(),
            note: z.string().trim().optional(),
        })
        .superRefine((data, ctx) => {
            if (data.resolution === 'PARTIAL_REFUND' && !data.refundAmount) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['refundAmount'],
                    message: 'Refund amount is required for partial refunds.',
                });
            }
        }),
    params: z.object({
        orderId: z.string().min(1, 'Order ID is required'),
        vendorId: z.string().min(1, 'Vendor ID is required'),
    }),
    query: z.object({}),
});
