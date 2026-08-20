FROM node:20-bookworm-slim AS base

# ffmpeg para cortar/recomponer los clips, python3+pip para yt-dlp
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    fonts-dejavu-core \
    fonts-liberation \
    fonts-comic-neue \
    ca-certificates \
    curl \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp faster-whisper piper-tts librosa bgutil-ytdlp-pot-provider yt-dlp-invidious \
    && rm -rf /var/lib/apt/lists/*

# Fuentes libres (Google Fonts, licencia OFL/Apache) para el selector de fuente del editor de
# texto del clip — no todas están empaquetadas para apt, así que se bajan directamente del
# repositorio oficial de Google Fonts. "%5B"/"%5D" son "[" "]" codificados: curl interpreta
# corchetes sin codificar como un rango/glob, no como parte literal de la URL.
RUN mkdir -p /usr/share/fonts/truetype/custom \
    && curl -fsSL -o /usr/share/fonts/truetype/custom/BebasNeue-Regular.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/bebasneue/BebasNeue-Regular.ttf" \
    && curl -fsSL -o /usr/share/fonts/truetype/custom/Anton-Regular.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf" \
    && curl -fsSL -o /usr/share/fonts/truetype/custom/Montserrat-Variable.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf" \
    && curl -fsSL -o /usr/share/fonts/truetype/custom/Poppins-Bold.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Bold.ttf" \
    && curl -fsSL -o /usr/share/fonts/truetype/custom/Oswald-Variable.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/oswald/Oswald%5Bwght%5D.ttf" \
    && curl -fsSL -o /usr/share/fonts/truetype/custom/PermanentMarker-Regular.ttf "https://raw.githubusercontent.com/google/fonts/main/apache/permanentmarker/PermanentMarker-Regular.ttf" \
    && curl -fsSL -o /usr/share/fonts/truetype/custom/Bangers-Regular.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/bangers/Bangers-Regular.ttf" \
    && curl -fsSL -o /usr/share/fonts/truetype/custom/Lobster-Regular.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/lobster/Lobster-Regular.ttf" \
    && curl -fsSL -o /usr/share/fonts/truetype/custom/ArchivoBlack-Regular.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/archivoblack/ArchivoBlack-Regular.ttf" \
    && curl -fsSL -o /usr/share/fonts/truetype/custom/Caveat-Variable.ttf "https://raw.githubusercontent.com/google/fonts/main/ofl/caveat/Caveat%5Bwght%5D.ttf" \
    && fc-cache -f

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
