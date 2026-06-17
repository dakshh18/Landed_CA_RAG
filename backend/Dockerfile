# syntax=docker/dockerfile:1

# ---- build stage: compile TypeScript -> dist/ ----
FROM node:20-slim AS build
WORKDIR /app
# Copy manifests first so this layer caches unless deps change.
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage: lean production image ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Only production deps in the final image.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Compiled JS only — no TypeScript, no source.
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/server.js"]
