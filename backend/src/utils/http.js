// Small helpers for consistent HTTP responses and error shapes.

export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const badRequest = (msg) => new HttpError(400, msg);
export const unauthorized = (msg = 'Unauthorized') => new HttpError(401, msg);
export const forbidden = (msg = 'Forbidden') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);
export const tooMany = (msg = 'Too many requests') => new HttpError(429, msg);

// Wrap async route handlers so rejected promises reach the error handler.
export const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
