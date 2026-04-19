FROM node:20-alpine

RUN apk add --no-cache postgresql-client bash

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
