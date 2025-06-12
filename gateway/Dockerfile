# Dockerfile for API Gateway
FROM node:18-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --production && \
    apk add --no-cache curl
COPY . .
EXPOSE 4010
CMD ["node", "src/index.js"]
