# A imagem oficial do Playwright ja traz o Chromium e as dependencias do sistema.
# A versao da imagem precisa ser a mesma do "playwright" no package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

ENV NODE_ENV=production
CMD ["node", "server.js"]
