import dotenv from 'dotenv';
dotenv.config();

const bool = (v) => String(v).trim().toLowerCase() === 'true';

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),

  // Database (raw PostgreSQL via node-postgres)
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@127.0.0.1:5432/deaddrop',

  // Auth
  jwtSecret: process.env.JWT_SECRET || 'change-me-dev-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  // Short-lived token used to authorize a single file download after "opening"
  fileTokenSecret: process.env.FILE_TOKEN_SECRET || 'change-me-file-secret',
  fileTokenTtlMs: parseInt(process.env.FILE_TOKEN_TTL_MS || '300000', 10),

  // Security defaults
  maxFailedAttempts: parseInt(process.env.MAX_FAILED_ATTEMPTS || '5', 10),
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10 MB
  uploadsDir: process.env.UPLOADS_DIR || 'uploads',

  // Function that marks time-expired packages (runs on an interval)
  expireIntervalMs: parseInt(process.env.EXPIRE_INTERVAL_MS || '60000', 10),
};

export const isProd = env.nodeEnv === 'production';
