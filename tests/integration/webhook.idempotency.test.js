import { prisma } from "../../src/config/prisma.js";

describe("WebhookEvent model", () => {
  beforeEach(async () => {
    await prisma.webhookEvent.deleteMany();
  });

  it("enforces unique Stripe event IDs", async () => {
    await prisma.webhookEvent.create({
      data: {
        stripeEventId: "evt_unique_test",
        type: "checkout.session.completed",
        processed: true,
      },
    });

    await expect(
      prisma.webhookEvent.create({
        data: {
          stripeEventId: "evt_unique_test",
          type: "checkout.session.completed",
          processed: true,
        },
      }),
    ).rejects.toThrow();
  });
});
