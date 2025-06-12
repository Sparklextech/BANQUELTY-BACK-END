# Dockerfile for Venue Service
FROM node:18-alpine
WORKDIR /usr/src/app
RUN apk add --no-cache curl
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 4002
CMD ["node", "src/index.js"]
