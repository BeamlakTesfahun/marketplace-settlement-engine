import { jest } from "@jest/globals";

const mockStripeCheckoutCreate = jest.fn();
const mockAddOrderConfirmationEmailJob = jest.fn();

jest.unstable_mockModule("../../src/config/stripe.js", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: mockStripeCheckoutCreate,
      },
    },
  },
}));

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
const { orderService } =
  await import("../../src/modules/orders/order.service.js");
const { processStripeEvent } =
  await import("../../src/modules/webhook/webhook.service.js");

describe("Inventory reservation workflow", () => {
  let customer;
  let vendor;
  let product;
  let cart;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockStripeCheckoutCreate.mockResolvedValue({
      id: "cs_inventory_test",
      url: "https://checkout.stripe.com/inventory-test",
    });

    await prisma.webhookEvent.deleteMany();
    await prisma.inventoryReservation.deleteMany();
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

    vendor = await prisma.vendor.create({
      data: {
        userId: vendorUser.id,
        storeName: "Inventory Store",
        status: "APPROVED",
      },
    });

    const category = await prisma.category.create({
      data: {
        name: "Inventory Test Category",
        slug: "inventory-test-category",
      },
    });

    product = await prisma.product.create({
      data: {
        vendorId: vendor.id,
        categoryId: category.id,
        name: "Inventory Test Product",
        slug: "inventory-test-product",
        price: 25,
        stock: 10,
        status: "ACTIVE",
      },
    });

    cart = await prisma.cart.create({
      data: {
        userId: customer.id,
      },
    });

    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId: product.id,
        quantity: 3,
      },
    });
  });

  it("creates ACTIVE reservation and decrements stock during checkout", async () => {
    const result = await orderService.checkout(customer);

    expect(result.orderId).toBeTruthy();
    expect(result.checkoutUrl).toBe(
      "https://checkout.stripe.com/inventory-test",
    );

    const updatedProduct = await prisma.product.findUnique({
      where: {
        id: product.id,
      },
    });

    expect(updatedProduct.stock).toBe(7);

    const reservations = await prisma.inventoryReservation.findMany({
      where: {
        orderId: result.orderId,
      },
    });

    expect(reservations).toHaveLength(1);
    expect(reservations[0].status).toBe("ACTIVE");
    expect(reservations[0].quantity).toBe(3);
    expect(reservations[0].expiresAt).toBeTruthy();

    const order = await prisma.order.findUnique({
      where: {
        id: result.orderId,
      },
    });

    expect(order.status).toBe("PENDING");
    expect(order.paymentStatus).toBe("PENDING");
    expect(order.stripeCheckoutSessionId).toBe("cs_inventory_test");
  });

  it("confirms reservation when payment succeeds", async () => {
    const result = await orderService.checkout(customer);

    const event = {
      id: "evt_inventory_paid_001",
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: {
            orderId: result.orderId,
          },
          payment_intent: "pi_inventory_paid_001",
        },
      },
    };

    await processStripeEvent(event);

    const order = await prisma.order.findUnique({
      where: {
        id: result.orderId,
      },
    });

    expect(order.status).toBe("CONFIRMED");
    expect(order.paymentStatus).toBe("PAID");

    const reservations = await prisma.inventoryReservation.findMany({
      where: {
        orderId: result.orderId,
      },
    });

    expect(reservations).toHaveLength(1);
    expect(reservations[0].status).toBe("CONFIRMED");

    const updatedProduct = await prisma.product.findUnique({
      where: {
        id: product.id,
      },
    });

    expect(updatedProduct.stock).toBe(7);
    expect(mockAddOrderConfirmationEmailJob).toHaveBeenCalledTimes(1);
  });

  it("expires reservation, restores stock, and cancels order when checkout expires", async () => {
    const result = await orderService.checkout(customer);

    const event = {
      id: "evt_inventory_expired_001",
      type: "checkout.session.expired",
      data: {
        object: {
          metadata: {
            orderId: result.orderId,
          },
        },
      },
    };

    await processStripeEvent(event);

    const order = await prisma.order.findUnique({
      where: {
        id: result.orderId,
      },
    });

    expect(order.status).toBe("CANCELLED");
    expect(order.paymentStatus).toBe("PENDING");
    expect(order.cancelledAt).toBeTruthy();

    const reservations = await prisma.inventoryReservation.findMany({
      where: {
        orderId: result.orderId,
      },
    });

    expect(reservations).toHaveLength(1);
    expect(reservations[0].status).toBe("EXPIRED");

    const updatedProduct = await prisma.product.findUnique({
      where: {
        id: product.id,
      },
    });

    expect(updatedProduct.stock).toBe(10);
  });

  it("does not restore stock twice for duplicate expired webhook", async () => {
    const result = await orderService.checkout(customer);

    const event = {
      id: "evt_inventory_duplicate_expired_001",
      type: "checkout.session.expired",
      data: {
        object: {
          metadata: {
            orderId: result.orderId,
          },
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

    expect(updatedProduct.stock).toBe(10);

    const reservations = await prisma.inventoryReservation.findMany({
      where: {
        orderId: result.orderId,
      },
    });

    expect(reservations).toHaveLength(1);
    expect(reservations[0].status).toBe("EXPIRED");

    const webhookEvents = await prisma.webhookEvent.findMany({
      where: {
        stripeEventId: event.id,
      },
    });

    expect(webhookEvents).toHaveLength(1);
  });

  it("releases reservation and restores stock when unpaid order is cancelled", async () => {
    const result = await orderService.checkout(customer);

    const cancelledOrder = await orderService.cancelOrder(
      customer,
      result.orderId,
    );

    expect(cancelledOrder.status).toBe("CANCELLED");

    const updatedProduct = await prisma.product.findUnique({
      where: {
        id: product.id,
      },
    });

    expect(updatedProduct.stock).toBe(10);

    const reservations = await prisma.inventoryReservation.findMany({
      where: {
        orderId: result.orderId,
      },
    });

    expect(reservations).toHaveLength(1);
    expect(reservations[0].status).toBe("RELEASED");
  });
});
