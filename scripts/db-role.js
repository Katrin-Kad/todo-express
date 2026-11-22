'use strict';

// Создает (или обновляет пароль) ограниченной роли с доступом только к таблице tasks.
//   npm run db:role -- todo_reviewer
// Пароль: из ROLE_PASSWORD или генерируется и выводится один раз.
require('dotenv').config({ quiet: true });

const crypto = require('node:crypto');
const { Client, escapeIdentifier, escapeLiteral } = require('pg');
const { loadDatabaseConfig } = require('../src/config');

const ROLE_RE = /^[a-z_][a-z0-9_]{0,62}$/;

async function main() {
  const role = process.argv[2];
  if (!role || !ROLE_RE.test(role)) {
    throw new Error('Укажите имя роли: npm run db:role -- todo_reviewer');
  }
  const db = loadDatabaseConfig(process.env, 'DATABASE_ADMIN_URL');
  const password = process.env.ROLE_PASSWORD || crypto.randomBytes(18).toString('base64url');
  const schema = escapeIdentifier(db.schema);
  const roleId = escapeIdentifier(role);

  const client = new Client({
    connectionString: db.connectionString,
    ssl: db.ssl,
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
    const verb = rowCount ? 'ALTER' : 'CREATE';
    await client.query(
      `${verb} ROLE ${roleId} LOGIN PASSWORD ${escapeLiteral(password)}
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 5`,
    );
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${roleId}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${schema}.tasks TO ${roleId}`);
    await client.query(`DROP POLICY IF EXISTS ${roleId} ON ${schema}.tasks`);
    await client.query(
      `CREATE POLICY ${roleId} ON ${schema}.tasks TO ${roleId} USING (true) WITH CHECK (true)`,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }

  console.log(`Роль ${role} готова, права на ${db.schema}.tasks выданы.`);
  if (!process.env.ROLE_PASSWORD) {
    console.log(`Пароль (сохраните сейчас, повторно не показывается): ${password}`);
  }
}

main().catch((err) => {
  console.error('Ошибка создания роли:', err.message);
  process.exit(1);
});
