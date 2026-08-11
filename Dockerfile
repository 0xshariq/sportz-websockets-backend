FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY src ./src
COPY drizzle.config.js .env.example ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/index.js"]
