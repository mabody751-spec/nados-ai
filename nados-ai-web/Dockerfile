# Nados API — production image (Phase 0).
# Multi-stage: the web bundle is built inside the image (dist is gitignored), then
# only runtime deps are kept. nut-js native postinstall is skipped (Windows-only,
# lazy-imported), while esbuild's binary is fetched so Vite can build.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts || npm install --ignore-scripts
RUN node node_modules/esbuild/install.js || true
COPY . .
RUN npm run build

FROM node:20-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts ./scripts
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
