export class AppError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Route not found', path: req.path });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  if (statusCode >= 500) console.error(`[${req.method} ${req.originalUrl}]`, error);
  res.status(statusCode).json({
    error: statusCode >= 500 ? 'Internal server error' : error.message,
    ...(error.details ? { details: error.details } : {}),
  });
}

export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
