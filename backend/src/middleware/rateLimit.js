import rateLimit from 'express-rate-limit';

// Global guard against abuse. The open-a package endpoints get a stricter
// limit below since they are password-bruteforce targets.
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});

export const unlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts to open packages.' },
});
