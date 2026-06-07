# Build Stage
FROM node:25.2.1-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Build with VITE_API_URL set to point to localhost:3000 (standard for local docker-compose where browser accesses backend)
ENV VITE_API_URL=http://localhost:3000/api

EXPOSE 8080

# RUN npm run build

CMD ["npm", "run", "dev"]

# Production Stage
# FROM nginx:alpine

# COPY --from=builder /app/dist /usr/share/nginx/html

# EXPOSE 80

# CMD ["nginx", "-g", "daemon off;"]
