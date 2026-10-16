FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm install
COPY apps/api ./apps/api
COPY db ./db
RUN npm run build -w @cowboybepob/api

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./package.json
COPY apps/api/package.json ./apps/api/package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["npm", "start"]
