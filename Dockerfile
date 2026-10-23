FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
ENV NODE_ENV=production NODE_OPTIONS=--no-warnings AIS_DATA=/data AIS_TRUST_PROXY=1 AIS_SECURE_COOKIES=1
EXPOSE 3000
CMD ["node", "server/index.js"]
