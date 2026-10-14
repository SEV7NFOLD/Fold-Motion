FROM node:20-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p /app/output

ENV NODE_ENV=production
ENV HOST=0.0.0.0

EXPOSE 10000

CMD ["npm", "start"]
