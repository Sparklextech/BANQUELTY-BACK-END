# Dockerfile for Media Service
FROM node:18-alpine
WORKDIR /usr/src/app
RUN apk add --no-cache curl
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 4006
CMD ["node", "src/index.js"]
