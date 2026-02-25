FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application
COPY . .

# Build for production
RUN npm run build

# Install serve
RUN npm install -g serve

# Expose port
EXPOSE 3000

# Run server
CMD ["serve", "-s", "build", "-l", "3000"]
