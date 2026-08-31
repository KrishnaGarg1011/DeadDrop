# DeadDrop API — deployable container (Railway / Render / Docker)
# Build context: repository root (so schema.sql is available), e.g.
#   docker build -f Dockerfile -t deaddrop-api .
FROM node:20-alpine

WORKDIR /app

# Backend dependencies
COPY backend/package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Application source
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY migrations ./migrations
COPY schema.sql ./schema.sql

# Uploaded files live here — mount a persistent volume here in production
RUN mkdir -p /app/uploads
ENV UPLOADS_DIR=/app/uploads
ENV NODE_ENV=production

EXPOSE 5000
CMD ["sh", "-c", "node scripts/migrate.js && node src/server.js"]
