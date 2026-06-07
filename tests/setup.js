import { prisma } from "../src/config/prisma.js";
import { connectRedis, redisClient } from "../src/config/redis.js";

beforeAll(async () => {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Tests must run with NODE_ENV=test");
  }

  await connectRedis();
});

afterAll(async () => {
  if (redisClient.isOpen) {
    await redisClient.quit();
  }

  await prisma.$disconnect();
});
