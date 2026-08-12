FROM node:22.21.0-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY src ./src
COPY .env.example ./
ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "src/bootstrap.js"]

FROM dependencies AS migrator
COPY drizzle.config.js ./
COPY drizzle ./drizzle
COPY src/db ./src/db
ENV NODE_ENV=production
USER node
CMD ["pnpm", "db:migrate"]
