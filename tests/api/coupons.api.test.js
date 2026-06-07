import request from "supertest";
import app from "../../src/app.js";

import { prisma } from "../../src/config/prisma.js";
import { generateToken } from "../../src/utils/generateToken.js";

describe("Coupons API", () => {
  let admin;
  let customer;
  let adminToken;
  let customerToken;
  let coupon;

  beforeEach(async () => {
    await prisma.couponUsage.deleteMany();
    await prisma.coupon.deleteMany();
    await prisma.user.deleteMany();

    admin = await prisma.user.create({
      data: {
        fullName: "Coupon Admin",
        email: "coupon-admin@test.com",
        password: "hashed-password",
        role: "ADMIN",
      },
    });

    customer = await prisma.user.create({
      data: {
        fullName: "Coupon Customer",
        email: "coupon-customer@test.com",
        password: "hashed-password",
        role: "CUSTOMER",
      },
    });

    adminToken = generateToken(admin.id);
    customerToken = generateToken(customer.id);

    coupon = await prisma.coupon.create({
      data: {
        code: "SAVE10",
        type: "PERCENTAGE",
        value: 10,
        status: "ACTIVE",
        usageLimit: 100,
        perUserLimit: 1,
      },
    });
  });

  it("allows admin to get coupon by id", async () => {
    const response = await request(app)
      .get(`/api/v1/coupons/${coupon.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toBe(coupon.id);
    expect(response.body.data.code).toBe("SAVE10");
  });

  it("allows admin to update coupon", async () => {
    const response = await request(app)
      .patch(`/api/v1/coupons/${coupon.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        status: "INACTIVE",
        usageLimit: 200,
        perUserLimit: 2,
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe("INACTIVE");
    expect(response.body.data.usageLimit).toBe(200);
    expect(response.body.data.perUserLimit).toBe(2);
  });

  it("rejects duplicate coupon code update", async () => {
    const otherCoupon = await prisma.coupon.create({
      data: {
        code: "WELCOME20",
        type: "PERCENTAGE",
        value: 20,
        status: "ACTIVE",
      },
    });

    const response = await request(app)
      .patch(`/api/v1/coupons/${otherCoupon.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        code: "SAVE10",
      });

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
  });

  it("rejects non-admin from updating coupon", async () => {
    const response = await request(app)
      .patch(`/api/v1/coupons/${coupon.id}`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        status: "INACTIVE",
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  it("returns 404 for missing coupon", async () => {
    const response = await request(app)
      .get("/api/v1/coupons/non-existing-id")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });
});
