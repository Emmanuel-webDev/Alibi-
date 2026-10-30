# Use lightweight official Node 20 LTS image
FROM node:20-alpine

WORKDIR /app

# Copy package manifests first for caching
COPY package*.json ./
RUN npm ci

# Copy source code and config
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to dist/
RUN npm run build

# Expose backend port
EXPOSE 8787

# Set production environment and start server
ENV NODE_ENV=production
ENV PORT=8787
CMD ["npm", "start"]
