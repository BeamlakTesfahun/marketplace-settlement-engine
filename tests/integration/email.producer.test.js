import { emailQueue } from "../../src/jobs/queues/email.queue.js";
import { addOrderConfirmationEmailJob } from "../../src/jobs/producers/email.producer.js";

describe("Email producer", () => {
  beforeEach(async () => {
    await emailQueue.drain(true);
  });

  afterAll(async () => {
    await emailQueue.close();
  });

  it("does not enqueue duplicate confirmation jobs for the same order", async () => {
    const payload = {
      to: "customer@example.com",
      customerName: "John Customer",
      orderId: "order_test_001",
      totalAmount: 100,
    };

    const firstJob = await addOrderConfirmationEmailJob(payload);

    const secondJob = await addOrderConfirmationEmailJob(payload);

    expect(firstJob.id).toBe(secondJob.id);

    const storedJob = await emailQueue.getJob(
      `order-confirmation-${payload.orderId}`,
    );

    expect(storedJob).toBeTruthy();

    expect(storedJob.data.orderId).toBe(payload.orderId);

    expect(storedJob.data.to).toBe(payload.to);

    expect(storedJob.data.customerName).toBe(payload.customerName);
  });

  it("creates separate confirmation jobs for different orders", async () => {
    const firstPayload = {
      to: "customer@example.com",
      customerName: "John Customer",
      orderId: "order_test_001",
      totalAmount: 100,
    };

    const secondPayload = {
      to: "customer@example.com",
      customerName: "John Customer",
      orderId: "order_test_002",
      totalAmount: 200,
    };

    const firstJob = await addOrderConfirmationEmailJob(firstPayload);

    const secondJob = await addOrderConfirmationEmailJob(secondPayload);

    expect(firstJob.id).not.toBe(secondJob.id);

    const firstStoredJob = await emailQueue.getJob(
      `order-confirmation-${firstPayload.orderId}`,
    );

    const secondStoredJob = await emailQueue.getJob(
      `order-confirmation-${secondPayload.orderId}`,
    );

    expect(firstStoredJob).toBeTruthy();

    expect(secondStoredJob).toBeTruthy();

    expect(firstStoredJob.data.orderId).toBe(firstPayload.orderId);

    expect(secondStoredJob.data.orderId).toBe(secondPayload.orderId);

    expect(firstStoredJob.id).not.toBe(secondStoredJob.id);
  });
});
