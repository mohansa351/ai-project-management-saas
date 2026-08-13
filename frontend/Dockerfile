# Multi-stage stub — Story 1.4 replaces the runtime CMD with the Next.js app.
FROM node:20-alpine AS build
WORKDIR /app
COPY scripts/docker-placeholder.mjs ./scripts/docker-placeholder.mjs

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/scripts ./scripts
EXPOSE 3000
CMD ["node", "scripts/docker-placeholder.mjs"]
