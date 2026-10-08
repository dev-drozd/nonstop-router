# Multi-stage build for NonStop Router
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .

# Build frontend and server
RUN npm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Runtime dependencies
RUN apk add --no-cache sqlite-libs

ENV NODE_ENV=production
ENV PORT=4000

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/public ./public

EXPOSE 4000

VOLUME ["/root/.nonstop"]

ENTRYPOINT ["node", "dist/server/index.js"]
