# Works on Fly.io, Railway, Google Cloud Run, a VPS... anything that runs a container.
FROM node:22-slim
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build
ENV PORT=3001
EXPOSE 3001
CMD ["npm", "start"]
