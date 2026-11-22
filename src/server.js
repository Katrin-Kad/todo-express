'use strict';

require('dotenv').config({ quiet: true });

const { loadConfig } = require('./config');
const { createPool, createTaskRepo } = require('./db');
const { createApp } = require('./app');

const config = loadConfig();
const pool = createPool(config.db);
const repo = createTaskRepo(pool, config.db.schema, config.author.login);
const app = createApp({ config, repo });

const server = app.listen(config.port, () => {
  console.log(`todo-express слушает порт ${config.port} (автор: ${config.author.login})`);
});

function shutdown(signal) {
  console.log(`${signal}: останавливаюсь`);
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
