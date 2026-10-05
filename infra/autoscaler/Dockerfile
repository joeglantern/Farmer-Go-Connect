FROM node:22-alpine
WORKDIR /app
COPY package.json decide.mjs index.mjs ./
USER node
CMD ["node", "index.mjs"]
