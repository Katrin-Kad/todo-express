'use strict';

// Создает схему и таблицу tasks через DATABASE_ADMIN_URL.
require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { loadDatabaseConfig, required } = require('../src/config');
const { renderSql } = require('./sql-template');

async function main() {
  const { schema, connectionString, ssl } = loadDatabaseConfig(
    process.env,
    'DATABASE_ADMIN_URL',
  );
  const ownerLogin = required(process.env, 'MOODLE_LOGIN');
  const client = new Client({ connectionString, ssl });
  const template = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  const sql = renderSql(template, { schema, owner_login: ownerLogin });

  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    const { rows } = await client.query('SELECT version()');
    console.log(`Готово: ${schema}.tasks создана/актуальна.`);
    console.log(rows[0].version);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Ошибка инициализации БД:', err.message);
  process.exit(1);
});
