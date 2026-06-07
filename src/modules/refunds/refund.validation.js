import { z } from "zod";

export const orderIdParamSchema = z.object({
  body: z.object({}),
  params: z.object({
    orderId: z.string().min(1, "Order ID is required"),
  }),
  query: z.object({}),
});

export const requestRefundSchema = z.object({
  body: z.object({
    reason: z.enum([
      "CUSTOMER_REQUEST",
      "DAMAGED_ITEM",
      "WRONG_ITEM",
      "PAYMENT_ISSUE",
      "OTHER",
    ]),
  }),
  params: z.object({
    orderId: z.string().min(1, "Order ID is required"),
  }),
  query: z.object({}),
});

export const rejectRefundSchema = z.object({
  body: z.object({
    reason: z.string().trim().optional(),
  }),
  params: z.object({
    orderId: z.string().min(1, "Order ID is required"),
  }),
  query: z.object({}),
});
