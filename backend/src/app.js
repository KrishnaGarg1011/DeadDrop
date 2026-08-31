import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import compression from 'compression';
import { globalLimiter } from './middleware/rateLimit.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.routes.js';
import packageRoutes from './routes/package.routes.js';
import adminRoutes from './routes/admin.routes.js';
import { isProd } from './config/env.js';

export const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(compression());
app.use(isProd ? morgan('combined') : morgan('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(globalLimiter);

app.get('/health', (req, res) => res.json({ ok: true, service: 'deaddrop-api' }));

app.use('/api/auth', authRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
