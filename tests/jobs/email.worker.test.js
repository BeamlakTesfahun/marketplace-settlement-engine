import { jest } from "@jest/globals";
import { Queue, QueueEvents } from "bullmq";
import { createEmailWorker } from "../../src/jobs/workers/createEmailWorker.js";
import { waitFor } from "../helpers/waitForJob.js";

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
};

const queueName = `email-queue-test-${Date.now()}`;

describe("Email queue worker behavior", () => {
  let queue;
  let queueEvents;
  let worker;

  beforeEach(async () => {
    queue = new Queue(queueName, { connection });
    queueEvents = new QueueEvents(queueName, { connection });
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    if (worker) await worker.close();
    await queueEvents.close();
    await queue.drain(true);
    await queue.close();
  });

  it("retries failed email jobs and eventually fails cleanly", async () => {
    const sendEmail = jest.fn().mockRejectedValue(new Error("SMTP failed"));

    worker = createEmailWorker({
      queueName,
      connection,
      sendEmail,
    });

    const job = await queue.add(
      "order-confirmation-email",
      {
        to: "customer@example.com",
        customerName: "John Customer",
        orderId: "order_123",
        totalAmount: 99.99,
      },
      {
        attempts: 3,
        backoff: {
          type: "fixed",
          delay: 100,
        },
        removeOnFail: false,
      },
    );

    await expect(job.waitUntilFinished(queueEvents, 10000)).rejects.toThrow();

    const failedJob = await queue.getJob(job.id);

    expect(sendEmail).toHaveBeenCalledTimes(3);
    expect(failedJob.attemptsMade).toBe(3);
    expect(failedJob.failedReason).toContain("SMTP failed");
  });

  it("eventually completes when retry succeeds", async () => {
    const sendEmail = jest
      .fn()
      .mockRejectedValueOnce(new Error("temporary SMTP issue"))
      .mockResolvedValueOnce(true);

    worker = createEmailWorker({
      queueName,
      connection,
      sendEmail,
    });

    const job = await queue.add(
      "order-confirmation-email",
      {
        to: "customer@example.com",
        customerName: "John Customer",
        orderId: "order_456",
        totalAmount: 49.99,
      },
      {
        attempts: 3,
        backoff: {
          type: "fixed",
          delay: 100,
        },
        removeOnComplete: false,
      },
    );

    await job.waitUntilFinished(queueEvents, 10000);

    await waitFor(() => {
      expect(sendEmail).toHaveBeenCalledTimes(2);
    });

    const completedJob = await queue.getJob(job.id);
    expect(completedJob.finishedOn).toBeTruthy();
  });

  it("does not enqueue duplicate order confirmation jobs with the same jobId", async () => {
    const firstJob = await queue.add(
      "order-confirmation-email",
      { orderId: "order_duplicate" },
      {
        jobId: "order-confirmation-order_duplicate",

        removeOnComplete: false,
      },
    );

    const secondJob = await queue.add(
      "order-confirmation-email",
      { orderId: "order_duplicate" },
      {
        jobId: "order-confirmation-order_duplicate",
        removeOnComplete: false,
      },
    );

    expect(firstJob.id).toBe(secondJob.id);

    const waitingJobs = await queue.getWaiting();
    expect(waitingJobs).toHaveLength(1);
  });
});
