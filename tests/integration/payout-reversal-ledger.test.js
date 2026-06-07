import { jest } from "@jest/globals";
import request from "supertest";

const mockAddRefundApprovedEmailJob = jest.fn();
const mockAddDisputeOpenedEmailJob = jest.fn();
const mockAddDisputeResolvedEmailJob = jest.fn();
const mockAddPayoutPaidEmailJob = jest.fn();
const mockAddPayoutReversalEmailJob = jest.fn();

jest.unstable_mockModule("../../src/config/stripe.js", () => ({
  stripe: {
    refunds: {
      create: jest.fn().mockResolvedValue({
        id: "re_test_refund_001",
      }),
    },
  },
}));

jest.unstable_mockModule("../../src/jobs/producers/email.producer.js", () => ({
  addOrderConfirmationEmailJob: jest.fn(),
  addRefundRequestedEmailJob: jest.fn(),
  addRefundApprovedEmailJob: mockAddRefundApprovedEmailJob,
  addRefundRejectedEmailJob: jest.fn(),
  addPayoutPaidEmailJob: mockAddPayoutPaidEmailJob,
  addPayoutFailedEmailJob: jest.fn(),
  addPayoutReversalEmailJob: mockAddPayoutReversalEmailJob,
  addDisputeOpenedEmailJob: mockAddDisputeOpenedEmailJob,
  addDisputeVendorRespondedEmailJob: jest.fn(),
  addDisputeResolvedEmailJob: mockAddDisputeResolvedEmailJob,
}));

const { default: app } = await import("../../src/app.js");
const { prisma } = await import("../../src/config/prisma.js");
const { generateToken } = await import("../../src/utils/generateToken.js");
const { payoutService } =
  await import("../../src/modules/payouts/payout.service.js");

describe("Payout reversals and vendor ledger", () => {
  let customer;
  let admin;
  let vendorUser;
  let vendor;
  let order;
  let payout;
  let customerToken;
  let adminToken;

  beforeEach(async () => {
    jest.clearAllMocks();

    await prisma.auditLog.deleteMany();
    await prisma.payoutReversal.deleteMany();
    await prisma.vendorLedgerEntry.deleteMany();
    await prisma.orderDispute.deleteMany();
    await prisma.vendorPayout.deleteMany();
    await prisma.webhookEvent.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await prisma.vendor.deleteMany();
    await prisma.user.deleteMany();

    customer = await prisma.user.create({
      data: {
        fullName: "Ledger Customer",
        email: "ledger-customer@test.com",
        password: "hashed-password",
        role: "CUSTOMER",
      },
    });

    admin = await prisma.user.create({
      data: {
        fullName: "Ledger Admin",
        email: "ledger-admin@test.com",
        password: "hashed-password",
        role: "ADMIN",
      },
    });

    vendorUser = await prisma.user.create({
      data: {
        fullName: "Ledger Vendor",
        email: "ledger-vendor@test.com",
        password: "hashed-password",
        role: "VENDOR",
      },
    });

    vendor = await prisma.vendor.create({
      data: {
        userId: vendorUser.id,
        storeName: "Ledger Store",
        status: "APPROVED",
      },
    });

    const category = await prisma.category.create({
      data: {
        name: "Ledger Category",
        slug: "ledger-category",
      },
    });

    const product = await prisma.product.create({
      data: {
        vendorId: vendor.id,
        categoryId: category.id,
        name: "Ledger Product",
        slug: "ledger-product",
        price: 100,
        stock: 10,
        status: "ACTIVE",
      },
    });

    order = await prisma.order.create({
      data: {
        userId: customer.id,
        subtotalAmount: 100,
        discountAmount: 0,
        totalAmount: 100,
        status: "DELIVERED",
        paymentStatus: "PAID",
        paidAt: new Date(),
        stripePaymentIntentId: "pi_ledger_test_001",
        refundStatus: "REQUESTED",
        refundReason: "CUSTOMER_REQUEST",
        refundRequestedAt: new Date(),
        refundRequestedById: customer.id,
        deliveredAt: new Date(),
        items: {
          create: {
            productId: product.id,
            vendorId: vendor.id,
            quantity: 1,
            price: 100,
          },
        },
      },
      include: {
        items: true,
      },
    });

    const availableAt = new Date();
    availableAt.setDate(availableAt.getDate() - 1);

    payout = await prisma.vendorPayout.create({
      data: {
        vendorId: vendor.id,
        orderId: order.id,
        grossAmount: 100,
        platformFee: 10,
        payoutAmount: 90,
        status: "ON_HOLD",
        holdReason: "PAYMENT_CAPTURED",
        availableAt,
        updatedAt: new Date(),
      },
    });

    customerToken = generateToken(customer.id);
    adminToken = generateToken(admin.id);
  });

  it("refund before payout is PAID reverses the held payout", async () => {
    const response = await request(app)
      .patch(`/api/v1/refunds/${order.id}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);

    const updatedPayout = await prisma.vendorPayout.findUnique({
      where: {
        id: payout.id,
      },
    });

    const ledgerEntry = await prisma.vendorLedgerEntry.findFirst({
      where: {
        vendorId: vendor.id,
        type: "REFUND_REVERSAL",
      },
    });

    expect(updatedPayout.status).toBe("REVERSED");
    expect(updatedPayout.holdReason).toBe("REFUND_REVERSED");
    expect(Number(ledgerEntry.amount)).toBe(-90);
    expect(Number(ledgerEntry.balanceAfter)).toBe(-90);
    expect(mockAddPayoutReversalEmailJob).toHaveBeenCalledTimes(1);
  });

  it("refund after payout is PAID creates payout reversal and vendor debit", async () => {
    await prisma.vendorPayout.update({
      where: {
        id: payout.id,
      },
      data: {
        status: "AVAILABLE",
      },
    });

    await payoutService.markPayoutAsPaid(admin, payout.id);

    const response = await request(app)
      .patch(`/api/v1/refunds/${order.id}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);

    const reversal = await prisma.payoutReversal.findFirst({
      where: {
        payoutId: payout.id,
      },
    });

    const debit = await prisma.vendorLedgerEntry.findFirst({
      where: {
        vendorId: vendor.id,
        type: "VENDOR_DEBIT",
      },
    });

    expect(reversal).toBeTruthy();
    expect(Number(reversal.amount)).toBe(90);
    expect(Number(debit.amount)).toBe(-90);
    expect(Number(debit.balanceAfter)).toBe(0);
    expect(mockAddPayoutReversalEmailJob).toHaveBeenCalledTimes(1);
  });

  it("partial refund creates proportional reversal amount", async () => {
    const reversal = await payoutService.applyRefundAgainstPayout({
      orderId: order.id,
      vendorId: vendor.id,
      refundAmount: 50,
      reason: "PARTIAL_REFUND",
      referenceType: "TEST",
      referenceId: "partial-refund-test",
      actorId: admin.id,
    });

    const ledgerEntry = await prisma.vendorLedgerEntry.findFirst({
      where: {
        vendorId: vendor.id,
        type: "REFUND_REVERSAL",
      },
    });

    expect(reversal.reversalAmount).toBe(45);
    expect(Number(ledgerEntry.amount)).toBe(-45);
  });

  it("dispute refund resolution triggers payout reversal logic", async () => {
    await prisma.order.update({
      where: {
        id: order.id,
      },
      data: {
        refundStatus: "NONE",
        refundReason: null,
        refundRequestedAt: null,
        refundRequestedById: null,
      },
    });

    const disputeResponse = await request(app)
      .post(`/api/v1/disputes/${order.id}/open`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        vendorId: vendor.id,
        reason: "Item arrived damaged",
      });

    expect(disputeResponse.status).toBe(201);

    const resolveResponse = await request(app)
      .patch(`/api/v1/disputes/${order.id}/vendors/${vendor.id}/resolve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        resolution: "REFUND",
        note: "Refund approved from dispute.",
      });

    expect(resolveResponse.status).toBe(200);
    expect(resolveResponse.body.data.dispute.status).toBe("RESOLVED_REFUND");

    const updatedPayout = await prisma.vendorPayout.findUnique({
      where: {
        id: payout.id,
      },
    });

    const ledgerEntry = await prisma.vendorLedgerEntry.findFirst({
      where: {
        vendorId: vendor.id,
        type: "REFUND_REVERSAL",
      },
    });

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        action: "PAYOUT_REVERSED_FOR_REFUND",
        entityId: payout.id,
      },
    });

    expect(updatedPayout.status).toBe("REVERSED");
    expect(ledgerEntry).toBeTruthy();
    expect(auditLog).toBeTruthy();
    expect(mockAddDisputeResolvedEmailJob).toHaveBeenCalledTimes(2);
    expect(mockAddPayoutReversalEmailJob).toHaveBeenCalledTimes(1);
  });
});
