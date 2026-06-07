import request from "supertest";
import app from "../../src/app.js";
import { prisma } from "../../src/config/prisma.js";

describe("Auth API", () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  it("registers a customer successfully", async () => {
    const response = await request(app).post("/api/v1/auth/register").send({
      fullName: "Test Customer",
      email: "customer@test.com",
      password: "password123",
      role: "CUSTOMER",
    });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe("customer@test.com");
    expect(response.body.data.token).toBeTruthy();
  });

  it("does not register duplicate email", async () => {
    await request(app).post("/api/v1/auth/register").send({
      fullName: "Test Customer",
      email: "duplicate@test.com",
      password: "password123",
      role: "CUSTOMER",
    });

    const response = await request(app).post("/api/v1/auth/register").send({
      fullName: "Test Customer Two",
      email: "duplicate@test.com",
      password: "password123",
      role: "CUSTOMER",
    });

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
  });

  it("logs in successfully with valid credentials", async () => {
    await request(app).post("/api/v1/auth/register").send({
      fullName: "Login User",
      email: "login@test.com",
      password: "password123",
      role: "CUSTOMER",
    });

    const response = await request(app).post("/api/v1/auth/login").send({
      email: "login@test.com",
      password: "password123",
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.token).toBeTruthy();
    expect(response.body.data.user.email).toBe("login@test.com");
  });

  it("rejects login with invalid credentials", async () => {
    const response = await request(app).post("/api/v1/auth/login").send({
      email: "missing@test.com",
      password: "wrongpassword",
    });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it("returns current user with valid token", async () => {
    const registerResponse = await request(app)
      .post("/api/v1/auth/register")
      .send({
        fullName: "Me User",
        email: "me@test.com",
        password: "password123",
        role: "CUSTOMER",
      });

    const token = registerResponse.body.data.token;

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.email).toBe("me@test.com");
  });

  it("rejects current user request without token", async () => {
    const response = await request(app).get("/api/v1/auth/me");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });
});
