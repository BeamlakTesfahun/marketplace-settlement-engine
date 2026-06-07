import app from "./app.js";
import { env } from "./config/env.js";
import { connectRedis } from "./config/redis.js";

const PORT = env.port || 4444;

const startServer = async () => {
  await connectRedis();

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
};

startServer();
