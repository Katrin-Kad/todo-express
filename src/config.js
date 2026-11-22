'use strict';

const fs = require('node:fs');

const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/;

function required(env, name) {
  const value = (env[name] ?? '').trim();
  if (!value) {
    throw new Error(`Не задана переменная окружения ${name} (см. .env.example)`);
  }
  return value;
}

function sslOptions(env) {
  const mode = (env.DB_SSL || 'require').trim().toLowerCase();
  if (mode === 'disable') return false;

  const caFile = (env.DB_SSL_CA_FILE || '').trim();
  const ca = caFile ? fs.readFileSync(caFile, 'utf8') : undefined;

  if (mode === 'verify-full') return { rejectUnauthorized: true, ca };
  if (mode === 'require') return { rejectUnauthorized: false, ca };
  throw new Error('DB_SSL: допустимо disable, require или verify-full');
}

function loadDatabaseConfig(env, connectionVariable = 'DATABASE_URL') {
  const schema = (env.DB_SCHEMA || 'todo').trim();
  if (!SCHEMA_RE.test(schema)) {
    throw new Error('DB_SCHEMA: только строчные латинские буквы, цифры и «_»');
  }
  return {
    connectionString: required(env, connectionVariable),
    schema,
    ssl: sslOptions(env),
  };
}

/** Читает конфигурацию из переменных окружения. Секреты в исходниках не хранятся. */
function loadConfig(env = process.env) {
  const apiToken = required(env, 'API_TOKEN');
  if (apiToken.length < 16) {
    throw new Error('API_TOKEN должен быть не короче 16 символов');
  }

  return {
    port: Number.parseInt(env.PORT || '3000', 10),
    author: {
      login: required(env, 'MOODLE_LOGIN'),
      fullName: required(env, 'MOODLE_FULL_NAME'),
    },
    apiToken,
    db: loadDatabaseConfig(env),
  };
}

module.exports = { loadConfig, loadDatabaseConfig, required };
