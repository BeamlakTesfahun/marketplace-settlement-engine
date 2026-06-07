import { jest } from "@jest/globals";

const mockStripeRefundCreate = jest.fn();
const mockAddRefundRequestedEmailJob = jest.fn();
const mockAddRefundApprovedEmailJob = jest.fn();
const mockAddRefundRejectedEmailJob = jest.fn();

jest.unstable_mockModule("../../src/config/stripe.js", () => ({
  stripe: {
    refunds: {
      create: mockStripeRefundCreate,
    },
  },
}));

jest.unstable_mockModule("../../src/jobs/producers/email.producer.js", () => ({
  addOrderConfirmationEmailJob: jest.fn(),
  addRefundRequestedEmailJob: mockAddRefundRequestedEmailJob,
  addRefundApprovedEmailJob: mockAddRefundApprovedEmailJob,
  addRefundRejectedEmailJob: mockAddRefundRejectedEmailJob,
  addPayoutPaidEmailJob: jest.fn(),
  addPayoutFailedEmailJob: jest.fn(),
  addPayoutReversalEmailJob: jest.fn(),
  addDisputeOpenedEmailJob: jest.fn(),
  addDisputeVendorRespondedEmailJob: jest.fn(),
  addDisputeResolvedEmailJob: jest.fn(),
}));

const request = (await import("supertest")).default;
const { default: app } = await import("../../src/app.js");
const { prisma } = await import("../../src/config/prisma.js");
const { generateToken } = await import("../../src/utils/generateToken.js");

describe("Refund API", () => {
  let customer;
  let admin;
  let customerToken;
  let adminToken;
  let order;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockStripeRefundCreate.mockResolvedValue({
      id: "re_api_test_001",
    });

    await prisma.webhookEvent.deleteMany();
    await prisma.orderItem.deleteMany();

    await prisma.order.deleteMany();
    await prisma.cartItem.deleteMany();
    await prisma.cart.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await prisma.vendor.deleteMany();
    await prisma.user.deleteMany();

    customer = await prisma.user.create({
      data: {
        fullName: "Refund API Customer",
        email: "refund-api-customer@test.com",
        password: "hashed-password",

        role: "CUSTOMER",
      },
    });

    admin = await prisma.user.create({
      data: {
        fullName: "Refund API Admin",
        email: "refund-api-admin@test.com",
        password: "hashed-password",
        role: "ADMIN",
      },
    });

    const vendorUser = await prisma.user.create({
      data: {
        fullName: "Refund API Vendor",
        email: "refund-api-vendor@test.com",
        password: "hashed-password",
        role: "VENDOR",
      },
    });

    const vendor = await prisma.vendor.create({
      data: {
        userId: vendorUser.id,
        storeName: "Refund API Store",
        status: "APPROVED",
      },
    });

    const category = await prisma.category.create({
      data: {
        name: "Refund API Category",
        slug: "refund-api-category",
      },
    });

    const product = await prisma.product.create({
      data: {
        vendorId: vendor.id,
        categoryId: category.id,
        name: "Refund API Product",
        slug: "refund-api-product",
        price: 40,
        stock: 10,
        status: "ACTIVE",
      },
    });

    order = await prisma.order.create({
      data: {
        userId: customer.id,
        totalAmount: 80,
        status: "CONFIRMED",
        paymentStatus: "PAID",
        stripePaymentIntentId: "pi_refund_api_test_001",
        paidAt: new Date(),
        items: {
          create: {
            productId: product.id,
            vendorId: vendor.id,
            quantity: 2,
            price: 40,
          },
        },
      },
    });

    customerToken = generateToken(customer.id);
    adminToken = generateToken(admin.id);
  });

  it("lets customer request refund", async () => {
    const response = await request(app)
      .post(`/api/v1/refunds/${order.id}/request`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        reason: "CUSTOMER_REQUEST",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.refundStatus).toBe("REQUESTED");

    expect(mockAddRefundRequestedEmailJob).toHaveBeenCalledTimes(1);
  });

  it("lets admin approve requested refund", async () => {
    await request(app)
      .post(`/api/v1/refunds/${order.id}/request`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        reason: "CUSTOMER_REQUEST",
      });

    const response = await request(app)
      .patch(`/api/v1/refunds/${order.id}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.paymentStatus).toBe("REFUNDED");
    expect(response.body.data.refundStatus).toBe("REFUNDED");

    expect(mockStripeRefundCreate).toHaveBeenCalledTimes(1);
    expect(mockAddRefundApprovedEmailJob).toHaveBeenCalledTimes(1);
  });

  it("lets admin reject requested refund", async () => {
    await request(app)
      .post(`/api/v1/refunds/${order.id}/request`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        reason: "OTHER",
      });

    const response = await request(app)
      .patch(`/api/v1/refunds/${order.id}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        reason: "Rejected after review",
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.refundStatus).toBe("REJECTED");

    expect(mockAddRefundRejectedEmailJob).toHaveBeenCalledTimes(1);
  });

  it("prevents non-admin from approving refund", async () => {
    await request(app)
      .post(`/api/v1/refunds/${order.id}/request`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        reason: "CUSTOMER_REQUEST",
      });

    const response = await request(app)
      .patch(`/api/v1/refunds/${order.id}/approve`)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });
});
