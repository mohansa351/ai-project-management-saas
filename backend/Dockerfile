# Multi-stage Express API — Story 1.3
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
RUN npm install --ignore-scripts

FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json prisma.config.ts tsconfig.build.json ./
COPY prisma ./prisma
COPY src ./src
ENV DATABASE_URL=postgresql://apm:apm@postgres:5432/apm
RUN npx prisma generate && npx tsc -p tsconfig.build.json

FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
EXPOSE 4000
CMD ["node", "dist/server.js"]
