import { redisClient } from "../config/redis.js";

export const cacheMiddleware = (keyPrefix, ttl = 300) => {
  return async (req, res, next) => {
    try {
      const userKey = req.user?.id || "public";

      const cacheKey = `${keyPrefix}:${userKey}:${req.originalUrl}`;
      const cachedData = await redisClient.get(cacheKey);

      if (cachedData) {
        console.log("Cache hit:", cacheKey);
        return res.status(200).json(JSON.parse(cachedData));
      }

      console.log("Cache miss:", cacheKey);

      const originalJson = res.json.bind(res);

      res.json = async (body) => {
        await redisClient.setEx(cacheKey, ttl, JSON.stringify(body));
        return originalJson(body);
      };

      next();
    } catch {
      next();
    }
  };
};
