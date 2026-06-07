import { stripe } from "../../config/stripe.js";
import { env } from "../../config/env.js";
import { processStripeEvent } from "./webhook.service.js";

export const handleStripeWebhook = async (req, res, next) => {
  try {
    const signature = req.headers["stripe-signature"];

    const event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      env.stripeWebhookSecret,
    );

    const result = await processStripeEvent(event);

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
