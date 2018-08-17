FROM node:carbon

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

ENV NODE_ENV production

COPY package.json package-lock.json ./
RUN npm install

ENV PORT 80
EXPOSE 80

CMD npm start
