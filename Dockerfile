FROM node:18-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY bin/ ./bin/
COPY lib/ ./lib/
COPY mcp-server.js ./
ENTRYPOINT ["node", "mcp-server.js"]
