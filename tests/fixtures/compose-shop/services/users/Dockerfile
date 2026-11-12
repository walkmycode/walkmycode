FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install --omit=dev
EXPOSE 8080
CMD ["node", "src/index.js"]
