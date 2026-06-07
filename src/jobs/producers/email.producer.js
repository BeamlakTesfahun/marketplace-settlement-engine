import { emailQueue } from "../queues/email.queue.js";

export const addOrderConfirmationEmailJob = async (payload) => {
  const job = await emailQueue.add("order-confirmation-email", payload, {
    jobId: `order-confirmation-${payload.orderId}`,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: false,
  });

  return job;
};

export const addRefundRequestedEmailJob = async (payload) => {
  return emailQueue.add("refund-requested-email", payload, {
    jobId: `refund-requested-${payload.orderId}`,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: false,
  });
};

export const addRefundApprovedEmailJob = async (payload) => {
  return emailQueue.add("refund-approved-email", payload, {
    jobId: `refund-approved-${payload.orderId}`,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: false,
  });
};

export const addRefundRejectedEmailJob = async (payload) => {
  return emailQueue.add("refund-rejected-email", payload, {
    jobId: `refund-rejected-${payload.orderId}`,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: false,
  });
};

export const addPayoutPaidEmailJob = async (payload) => {
  return emailQueue.add("payout-paid-email", payload, {
    jobId: `payout-paid-${payload.payoutId}`,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: false,
  });
};

export const addPayoutFailedEmailJob = async (payload) => {
  return emailQueue.add("payout-failed-email", payload, {
    jobId: `payout-failed-${payload.payoutId}`,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: false,
  });
};

export const addDisputeOpenedEmailJob = async (payload) => {
  return emailQueue.add("dispute-opened-email", payload, {
    jobId: `dispute-opened-${payload.disputeId}`,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: false,
  });
};

export const addDisputeVendorRespondedEmailJob = async (payload) => {
  return emailQueue.add("dispute-vendor-responded-email", payload, {
    jobId: `dispute-vendor-responded-${payload.disputeId}`,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: false,
  });
};

export const addDisputeResolvedEmailJob = async (payload) => {
  return emailQueue.add("dispute-resolved-email", payload, {
    jobId: `dispute-resolved-${payload.disputeId}-${payload.recipientType}`,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: false,
  });
};

export const addPayoutReversalEmailJob = async (payload) => {
  return emailQueue.add("payout-reversal-email", payload, {
    jobId: `payout-reversal-${payload.payoutId}-${payload.referenceId}`,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: false,
  });
};
