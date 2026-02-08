FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY dist ./dist

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
