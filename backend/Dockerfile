# Multi-stage stub — Story 1.3 replaces the runtime CMD with the Express app.
FROM node:20-alpine AS build
WORKDIR /app
COPY scripts/docker-placeholder.mjs ./scripts/docker-placeholder.mjs

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/scripts ./scripts
EXPOSE 4000
CMD ["node", "scripts/docker-placeholder.mjs"]
