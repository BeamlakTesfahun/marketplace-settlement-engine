import request from "supertest";
import app from "../../src/app.js";

import { prisma } from "../../src/config/prisma.js";
import { generateToken } from "../../src/utils/generateToken.js";

describe("Audit Logs API", () => {
  let admin;
  let customer;
  let adminToken;
  let customerToken;
  let auditLog;

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.user.deleteMany();

    admin = await prisma.user.create({
      data: {
        fullName: "Audit Admin",
        email: "audit-admin@test.com",
        password: "hashed-password",
        role: "ADMIN",
      },
    });

    customer = await prisma.user.create({
      data: {
        fullName: "Audit Customer",
        email: "audit-customer@test.com",
        password: "hashed-password",
        role: "CUSTOMER",
      },
    });

    adminToken = generateToken(admin.id);
    customerToken = generateToken(customer.id);

    auditLog = await prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "REFUND_APPROVED",
        entityType: "ORDER",
        entityId: "order_test_001",
        metadata: {
          refundAmount: 100,
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: customer.id,
        action: "ORDER_CANCELLED",
        entityType: "ORDER",
        entityId: "order_test_002",
        metadata: {
          reason: "Customer cancelled order",
        },
      },
    });
  });

  it("allows admin to list audit logs", async () => {
    const response = await request(app)
      .get("/api/v1/audit-logs")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.data).toHaveLength(2);
    expect(response.body.data.meta.total).toBe(2);
  });

  it("allows admin to filter audit logs by action", async () => {
    const response = await request(app)
      .get("/api/v1/audit-logs?action=REFUND_APPROVED")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.data).toHaveLength(1);
    expect(response.body.data.data[0].action).toBe("REFUND_APPROVED");
  });

  it("allows admin to filter audit logs by entityType, entityId, and userId", async () => {
    const response = await request(app)
      .get(
        `/api/v1/audit-logs?entityType=ORDER&entityId=order_test_001&userId=${admin.id}`,
      )
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.data).toHaveLength(1);
    expect(response.body.data.data[0].entityId).toBe("order_test_001");
    expect(response.body.data.data[0].userId).toBe(admin.id);
  });

  it("allows admin to get an audit log by id", async () => {
    const response = await request(app)
      .get(`/api/v1/audit-logs/${auditLog.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.id).toBe(auditLog.id);
    expect(response.body.data.action).toBe("REFUND_APPROVED");
  });

  it("rejects non-admin users from listing audit logs", async () => {
    const response = await request(app)
      .get("/api/v1/audit-logs")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });

  it("rejects unauthenticated users from listing audit logs", async () => {
    const response = await request(app).get("/api/v1/audit-logs");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it("returns 404 when audit log does not exist", async () => {
    const response = await request(app)
      .get("/api/v1/audit-logs/non-existing-id")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  });
});
