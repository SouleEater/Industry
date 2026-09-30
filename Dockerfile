# Сборка и запуск сервера «Индустрии».
#   docker build -t industry .
#   docker run -p 8080:8080 -v industry-data:/data -e PUBLIC_ORIGIN=https://example.com industry
# Полная схема с HTTPS: docker-compose.yml и docs/07-deployment.md.

# ---- 1. сборка: упаковка картинок и единый HTML стола ----
FROM node:24-bookworm-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pil python3-numpy \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
# Если рядом лежит apps/web/assets/official (картинки из PDF издателя), они попадут в образ.
# Без неё карты «Интербеллума» рисуются схематично. Публично раздавать такие картинки нельзя.
RUN python3 scripts/pack-table-images.py && node scripts/build-table.mjs

# ---- 2. рабочий образ: только сервер, ядро правил и собранная страница ----
FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/data
WORKDIR /app
COPY package.json ./
COPY --from=build /app/server ./server
COPY --from=build /app/packages ./packages
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
