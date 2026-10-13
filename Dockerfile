FROM node:24-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build \
    && mkdir -p /var/lib/ninegrid/uploads \
    && chown -R node:node /var/lib/ninegrid

ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 UPLOAD_DIR=/var/lib/ninegrid/uploads
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start"]
