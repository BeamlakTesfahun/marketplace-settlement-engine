import { jest } from "@jest/globals";

const mockAddOrderConfirmationEmailJob = jest.fn();

jest.unstable_mockModule("../../src/jobs/producers/email.producer.js", () => ({
  addOrderConfirmationEmailJob: mockAddOrderConfirmationEmailJob,
  addRefundRequestedEmailJob: jest.fn(),
  addRefundApprovedEmailJob: jest.fn(),
  addRefundRejectedEmailJob: jest.fn(),
  addPayoutPaidEmailJob: jest.fn(),
  addPayoutFailedEmailJob: jest.fn(),
  addPayoutReversalEmailJob: jest.fn(),
  addDisputeOpenedEmailJob: jest.fn(),
  addDisputeVendorRespondedEmailJob: jest.fn(),
  addDisputeResolvedEmailJob: jest.fn(),
}));

const { prisma } = await import("../../src/config/prisma.js");

const { processStripeEvent } =
  await import("../../src/modules/webhook/webhook.service.js");

describe("Stripe webhook processing", () => {
  beforeEach(async () => {
    jest.clearAllMocks();

    await prisma.auditLog.deleteMany();
    await prisma.vendorPayout.deleteMany();
    await prisma.webhookEvent.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.cartItem.deleteMany();
    await prisma.cart.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await prisma.vendor.deleteMany();
    await prisma.user.deleteMany();
  });

  it("marks an order as paid and queues confirmation email", async () => {
    const user = await prisma.user.create({
      data: {
        fullName: "Webhook User",
        email: "webhook@test.com",
        password: "hashed-password",
        role: "CUSTOMER",
      },
    });

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        totalAmount: 100,
        status: "PENDING",
        paymentStatus: "PENDING",
      },
    });

    const event = {
      id: "evt_test_paid_001",
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: {
            orderId: order.id,
          },
          payment_intent: "pi_test_001",
        },
      },
    };

    const result = await processStripeEvent(event);

    expect(result.processed).toBe(true);
    expect(result.duplicate).toBe(false);

    const updatedOrder = await prisma.order.findUnique({
      where: {
        id: order.id,
      },
    });

    expect(updatedOrder.paymentStatus).toBe("PAID");
    expect(updatedOrder.status).toBe("CONFIRMED");
    expect(updatedOrder.stripePaymentIntentId).toBe("pi_test_001");
    expect(updatedOrder.paidAt).toBeTruthy();

    expect(mockAddOrderConfirmationEmailJob).toHaveBeenCalledTimes(1);
    expect(mockAddOrderConfirmationEmailJob).toHaveBeenCalledWith({
      to: user.email,
      customerName: user.fullName,
      orderId: order.id,
      totalAmount: 100,
    });

    const webhookEvents = await prisma.webhookEvent.findMany({
      where: {
        stripeEventId: event.id,
      },
    });

    expect(webhookEvents).toHaveLength(1);
    expect(webhookEvents[0].processed).toBe(true);
  });

  it("allocates vendor payouts on hold and writes payout-hold audit log on payment", async () => {
    const customer = await prisma.user.create({
      data: {
        fullName: "Settlement Customer",
        email: "settlement-customer@test.com",
        password: "hashed-password",
        role: "CUSTOMER",
      },
    });

    const vendorUser = await prisma.user.create({
      data: {
        fullName: "Settlement Vendor",
        email: "settlement-vendor@test.com",
        password: "hashed-password",
        role: "VENDOR",
      },
    });

    const vendor = await prisma.vendor.create({
      data: {
        userId: vendorUser.id,
        storeName: "Settlement Store",
        status: "APPROVED",
      },
    });

    const category = await prisma.category.create({
      data: {
        name: "Settlement Category",
        slug: "settlement-category",
      },
    });

    const product = await prisma.product.create({
      data: {
        vendorId: vendor.id,
        categoryId: category.id,
        name: "Settlement Product",
        slug: "settlement-product",
        price: 50,
        stock: 10,
        status: "ACTIVE",
      },
    });

    const order = await prisma.order.create({
      data: {
        userId: customer.id,
        totalAmount: 100,
        status: "PENDING",
        paymentStatus: "PENDING",
        items: {
          create: {
            productId: product.id,
            vendorId: vendor.id,
            quantity: 2,
            price: 50,
          },
        },
      },
    });

    const event = {
      id: "evt_settlement_hold_001",
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: {
            orderId: order.id,
          },
          payment_intent: "pi_settlement_hold_001",
        },
      },
    };

    await processStripeEvent(event);

    const updatedOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });

    expect(updatedOrder.paymentStatus).toBe("PAID");
    expect(updatedOrder.status).toBe("CONFIRMED");

    const payouts = await prisma.vendorPayout.findMany({
      where: { orderId: order.id },
    });

    expect(payouts).toHaveLength(1);
    expect(payouts[0].status).toBe("ON_HOLD");
    expect(payouts[0].holdReason).toBe("PAYMENT_CAPTURED");
    expect(Number(payouts[0].grossAmount)).toBe(100);
    expect(Number(payouts[0].platformFee)).toBe(10);
    expect(Number(payouts[0].payoutAmount)).toBe(90);
    expect(payouts[0].availableAt).toBeNull();

    const holdAudit = await prisma.auditLog.findFirst({
      where: {
        action: "PAYOUT_ALLOCATED_ON_HOLD",
        entityId: order.id,
      },
    });

    expect(holdAudit).toBeTruthy();
    expect(holdAudit.entityType).toBe("ORDER");
    expect(holdAudit.metadata.payouts).toHaveLength(1);
    expect(holdAudit.metadata.payouts[0].status).toBe("ON_HOLD");
    expect(holdAudit.metadata.payouts[0].holdReason).toBe("PAYMENT_CAPTURED");
  });

  it("does not process the same Stripe event twice", async () => {
    const user = await prisma.user.create({
      data: {
        fullName: "Duplicate User",
        email: "duplicate@test.com",
        password: "hashed-password",
        role: "CUSTOMER",
      },
    });

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        totalAmount: 150,
        status: "PENDING",
        paymentStatus: "PENDING",
      },
    });

    const event = {
      id: "evt_test_duplicate_001",
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: {
            orderId: order.id,
          },
          payment_intent: "pi_duplicate_001",
        },
      },
    };

    const firstResult = await processStripeEvent(event);
    const secondResult = await processStripeEvent(event);

    expect(firstResult.processed).toBe(true);
    expect(firstResult.duplicate).toBe(false);

    expect(secondResult.duplicate).toBe(true);
    expect(secondResult.processed).toBe(false);

    const updatedOrder = await prisma.order.findUnique({
      where: {
        id: order.id,
      },
    });

    expect(updatedOrder.paymentStatus).toBe("PAID");
    expect(updatedOrder.status).toBe("CONFIRMED");

    expect(mockAddOrderConfirmationEmailJob).toHaveBeenCalledTimes(1);

    const webhookEvents = await prisma.webhookEvent.findMany({
      where: {
        stripeEventId: event.id,
      },
    });

    expect(webhookEvents).toHaveLength(1);
  });

  it("does not enqueue email again if order is already paid", async () => {
    const user = await prisma.user.create({
      data: {
        fullName: "Paid User",
        email: "paid@test.com",
        password: "hashed-password",
        role: "CUSTOMER",
      },
    });

    const order = await prisma.order.create({
      data: {
        userId: user.id,
        totalAmount: 75,
        status: "CONFIRMED",
        paymentStatus: "PAID",
        paidAt: new Date(),
      },
    });

    const event = {
      id: "evt_test_already_paid_001",
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: {
            orderId: order.id,
          },
          payment_intent: "pi_paid_001",
        },
      },
    };

    const result = await processStripeEvent(event);

    expect(result.processed).toBe(true);
    expect(result.duplicate).toBe(false);

    expect(mockAddOrderConfirmationEmailJob).not.toHaveBeenCalled();

    const updatedOrder = await prisma.order.findUnique({
      where: {
        id: order.id,
      },
    });

    expect(updatedOrder.paymentStatus).toBe("PAID");
    expect(updatedOrder.status).toBe("CONFIRMED");
  });

  it("does not change order items or product stock when duplicate webhook is received", async () => {
    const customer = await prisma.user.create({
      data: {
        fullName: "Stock Customer",
        email: "stock-customer@test.com",
        password: "hashed-password",
        role: "CUSTOMER",
      },
    });

    const vendorUser = await prisma.user.create({
      data: {
        fullName: "Stock Vendor",
        email: "stock-vendor@test.com",
        password: "hashed-password",
        role: "VENDOR",
      },
    });

    const vendor = await prisma.vendor.create({
      data: {
        userId: vendorUser.id,
        storeName: "Stock Vendor Store",
        status: "APPROVED",
      },
    });

    const category = await prisma.category.create({
      data: {
        name: "Stock Category",
        slug: "stock-category",
      },
    });

    const product = await prisma.product.create({
      data: {
        vendorId: vendor.id,
        categoryId: category.id,
        name: "Stock Product",
        slug: "stock-product",
        price: 50,
        stock: 7,
        status: "ACTIVE",
      },
    });

    const order = await prisma.order.create({
      data: {
        userId: customer.id,
        totalAmount: 100,
        status: "PENDING",
        paymentStatus: "PENDING",
        items: {
          create: {
            productId: product.id,
            vendorId: vendor.id,
            quantity: 2,
            price: 50,
          },
        },
      },
      include: {
        items: true,
      },
    });

    const event = {
      id: "evt_stock_duplicate_001",
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: {
            orderId: order.id,
          },
          payment_intent: "pi_stock_duplicate_001",
        },
      },
    };

    await processStripeEvent(event);
    await processStripeEvent(event);

    const updatedProduct = await prisma.product.findUnique({
      where: {
        id: product.id,
      },
    });

    const orderItems = await prisma.orderItem.findMany({
      where: {
        orderId: order.id,
      },
    });

    const webhookEvents = await prisma.webhookEvent.findMany({
      where: {
        stripeEventId: event.id,
      },
    });

    expect(updatedProduct.stock).toBe(7);
    expect(orderItems).toHaveLength(1);
    expect(orderItems[0].quantity).toBe(2);
    expect(webhookEvents).toHaveLength(1);
    expect(mockAddOrderConfirmationEmailJob).toHaveBeenCalledTimes(1);
  });

  it("does not decrement stock again when duplicate payment webhook is processed", async () => {
    const customer = await prisma.user.create({
      data: {
        fullName: "Inventory Customer",
        email: "inventory-customer@test.com",
        password: "hashed-password",
        role: "CUSTOMER",
      },
    });

    const vendorUser = await prisma.user.create({
      data: {
        fullName: "Inventory Vendor",
        email: "inventory-vendor@test.com",
        password: "hashed-password",
        role: "VENDOR",
      },
    });

    const vendor = await prisma.vendor.create({
      data: {
        userId: vendorUser.id,
        storeName: "Inventory Store",
        status: "APPROVED",
      },
    });

    const category = await prisma.category.create({
      data: {
        name: "Inventory Category",
        slug: "inventory-category",
      },
    });

    const product = await prisma.product.create({
      data: {
        vendorId: vendor.id,
        categoryId: category.id,
        name: "Inventory Product",
        slug: "inventory-product",
        price: 40,
        stock: 8,
        status: "ACTIVE",
      },
    });

    const order = await prisma.order.create({
      data: {
        userId: customer.id,
        totalAmount: 80,
        status: "PENDING",
        paymentStatus: "PENDING",
        items: {
          create: {
            productId: product.id,
            vendorId: vendor.id,
            quantity: 2,
            price: 40,
          },
        },
      },
      include: {
        items: true,
      },
    });

    const event = {
      id: "evt_inventory_duplicate_001",
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: {
            orderId: order.id,
          },
          payment_intent: "pi_inventory_duplicate_001",
        },
      },
    };

    await processStripeEvent(event);
    await processStripeEvent(event);

    const updatedProduct = await prisma.product.findUnique({
      where: {
        id: product.id,
      },
    });

    const updatedOrder = await prisma.order.findUnique({
      where: {
        id: order.id,
      },
      include: {
        items: true,
      },
    });

    const webhookEvents = await prisma.webhookEvent.findMany({
      where: {
        stripeEventId: event.id,
      },
    });

    expect(updatedProduct.stock).toBe(8);
    expect(updatedOrder.paymentStatus).toBe("PAID");
    expect(updatedOrder.status).toBe("CONFIRMED");
    expect(updatedOrder.items).toHaveLength(1);
    expect(updatedOrder.items[0].quantity).toBe(2);
    expect(webhookEvents).toHaveLength(1);
    expect(mockAddOrderConfirmationEmailJob).toHaveBeenCalledTimes(1);
  });
});
