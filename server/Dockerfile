# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build application
RUN npm run build

# Stage 2: Development
FROM node:20-alpine AS dev

WORKDIR /app

# Install runtime tools required by health checks and Prisma engines
RUN apk add --no-cache curl openssl

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma Client
RUN npm run prisma:generate

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Start application in watch mode
CMD ["npm", "run", "dev"]

# Stage 3: Runner (Production)
FROM node:20-alpine

WORKDIR /app

# Install runtime tools required by health checks and Prisma engines
RUN apk add --no-cache curl openssl

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Copy Prisma schema and migrations for startup deploy
COPY --from=builder /app/prisma ./prisma

# Generate Prisma Client in the production image
RUN npm run prisma:generate

# Copy container entrypoint
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Run Prisma migrations before starting the application
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
