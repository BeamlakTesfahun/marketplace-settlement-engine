import { AppError } from "../utils/AppError.js";

export const basicAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", "Basic");
    throw new AppError("Authentication required.", 401, "UNAUTHORIZED");
  }

  const base64Credentials = authHeader.split(" ")[1];
  const credentials = Buffer.from(base64Credentials, "base64").toString(
    "utf-8",
  );

  const [username, password] = credentials.split(":");

  if (
    username !== process.env.BULL_BOARD_USERNAME ||
    password !== process.env.BULL_BOARD_PASSWORD
  ) {
    res.setHeader("WWW-Authenticate", "Basic");
    throw new AppError("Invalid credentials.", 401, "UNAUTHORIZED");
  }

  next();
};
