FROM node:22.21.0-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS production
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY src ./src
COPY .env.example ./
ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "src/index.js"]

FROM dependencies AS migrator
COPY drizzle.config.js ./
COPY drizzle ./drizzle
COPY src/db ./src/db
ENV NODE_ENV=production
CMD ["pnpm", "db:migrate"]
