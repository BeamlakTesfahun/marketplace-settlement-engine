export const errorHandler = (err, req, res, next) => {
  const isOperational = err.isOperational === true;

  const statusCode = isOperational ? err.statusCode : 500;
  const message = isOperational ? err.message : "Internal Server Error";
  const code = isOperational ? err.code : "INTERNAL_SERVER_ERROR";
  const details = isOperational ? err.details : null;

  return res.status(statusCode).json({
    success: false,
    message,
    code,
    details,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
};
