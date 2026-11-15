# «الملعب» WhatsApp bot. Build from this folder:  docker build -t al-malab-whatsapp-bot .
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src

# The session (the link to the number) and the queue live in /data. Give it
# persistent storage from the host (on Railway: attached storage mounted at
# /data; with Docker: docker run -v name:/data), or every restart asks for the
# QR code again. That is declared on the host only: Railway refuses a
# Dockerfile that declares it. The bot starts as root only to give /data to
# the "node" user, then runs as that user (src/start.mjs).

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
CMD ["node", "src/start.mjs"]
