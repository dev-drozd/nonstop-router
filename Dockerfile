# Multi-stage build for NonStop Router
FROM node:20-alpine AS builder

WORKDIR /app

# Install build deps for better-sqlite3 (native module)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .

# Build frontend and server
RUN npm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Runtime deps: sqlite libs + tini for correct signal handling
RUN apk add --no-cache sqlite-libs tini

ENV NODE_ENV=production
ENV PORT=4000
ENV NO_OPEN=1

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/public ./public

# Run as an unprivileged user
RUN addgroup -S nonstop && adduser -S nonstop -G nonstop \
  && mkdir -p /home/nonstop/.nonstop \
  && chown -R nonstop:nonstop /home/nonstop/.nonstop
USER nonstop

EXPOSE 4000

VOLUME ["/home/nonstop/.nonstop"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server/index.js"]