FROM node:20-bookworm-slim AS base

# ffmpeg para cortar/recomponer los clips, python3+pip para yt-dlp
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    fonts-dejavu-core \
    ca-certificates \
    curl \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build

RUN mkdir -p /app/storage
VOLUME ["/app/storage"]

EXPOSE 3000
ENV NODE_ENV=production

CMD ["npm", "run", "start"]
