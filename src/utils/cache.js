import { redisClient } from "../config/redis.js";

export const clearCacheByPattern = async (pattern) => {
  const keys = await redisClient.keys(pattern);

  if (keys.length > 0) {
    await redisClient.del(keys);
  }
};
