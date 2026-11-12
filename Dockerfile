FROM node:20-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Launch films render in headless Chromium (src/browser/). It's off by default so the
# image fits a free Render instance; the studio then says launch films can't render
# here (render them locally instead). FOLD_LAUNCH=1 adds Chromium, which needs an
# instance with about 2 GB of memory to render reliably.
ARG FOLD_LAUNCH=0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN if [ "$FOLD_LAUNCH" = "1" ]; then \
      npm install --no-save "playwright@$(node -p "require('./package.json').devDependencies.playwright")" \
      && npx playwright install --with-deps chromium \
      && rm -rf /var/lib/apt/lists/*; \
    fi

COPY . .
RUN mkdir -p /app/output

ENV NODE_ENV=production
ENV HOST=0.0.0.0

EXPOSE 10000

CMD ["npm", "start"]
