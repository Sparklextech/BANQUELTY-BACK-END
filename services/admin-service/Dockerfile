# Dockerfile for Admin Service
FROM node:18-alpine
WORKDIR /usr/src/app
RUN apk add --no-cache curl
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 4004
CMD ["node", "src/index.js"]
