FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install
COPY . .
ARG REACT_APP_SUPABASE_URL
ARG REACT_APP_SUPABASE_PUBLISHABLE_DEFAULT_KEY
ARG REACT_APP_STRIPE_PUBLISHABLE_KEY
ENV REACT_APP_SUPABASE_URL=$REACT_APP_SUPABASE_URL
ENV REACT_APP_SUPABASE_PUBLISHABLE_DEFAULT_KEY=$REACT_APP_SUPABASE_PUBLISHABLE_DEFAULT_KEY
ENV REACT_APP_STRIPE_PUBLISHABLE_KEY=$REACT_APP_STRIPE_PUBLISHABLE_KEY
RUN npm run build

FROM nginx:1.25-alpine
ARG APP_VERSION=4.0.0
LABEL org.opencontainers.image.title="Inkflow"
LABEL org.opencontainers.image.version="${APP_VERSION}"
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
