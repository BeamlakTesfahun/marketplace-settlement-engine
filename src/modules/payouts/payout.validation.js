import { z } from "zod";

export const payoutIdParamSchema = z.object({
  body: z.object({}),
  params: z.object({
    payoutId: z.string().min(1, "Payout ID is required"),
  }),
  query: z.object({}),
});

export const failPayoutSchema = z.object({
  body: z.object({
    reason: z.string().trim().min(1, "Failure reason is required"),
  }),
  params: z.object({
    payoutId: z.string().min(1, "Payout ID is required"),
  }),
  query: z.object({}),
});
