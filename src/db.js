'use strict';

const { Pool, escapeIdentifier } = require('pg');

function createPool(dbConfig) {
  const pool = new Pool({
    connectionString: dbConfig.connectionString,
    ssl: dbConfig.ssl,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    query_timeout: 10000,
    application_name: 'todo-express',
  });
  // Обрыв простаивающего соединения не должен ронять процесс:
  // следующий запрос получит новое соединение или 503.
  pool.on('error', (err) => console.error('[db] ошибка простаивающего соединения:', err.message));
  return pool;
}

const COLUMNS = 'id, owner_login, title, done, run_id, created_at';

/** Физическая строка БД → объект API (имена полей из задания). */
function toApi(row) {
  return {
    id: row.id,
    ownerLogin: row.owner_login,
    title: row.title,
    done: row.done,
    runId: row.run_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Все запросы ограничены делами автора (owner_login из конфигурации). */
function createTaskRepo(pool, schema, ownerLogin) {
  const table = `${escapeIdentifier(schema)}.tasks`;

  return {
    async create({ id, title, runId }) {
      const { rows } = await pool.query(
        `INSERT INTO ${table} (id, owner_login, title, done, run_id)
         VALUES ($1, $2, $3, false, $4)
         RETURNING ${COLUMNS}`,
        [id, ownerLogin, title, runId],
      );
      return toApi(rows[0]);
    },

    async listByRun(runId) {
      const { rows } = await pool.query(
        `SELECT ${COLUMNS} FROM ${table}
         WHERE owner_login = $1 AND run_id = $2
         ORDER BY created_at, id`,
        [ownerLogin, runId],
      );
      return rows.map(toApi);
    },

    async get(id) {
      const { rows } = await pool.query(
        `SELECT ${COLUMNS} FROM ${table} WHERE id = $1 AND owner_login = $2`,
        [id, ownerLogin],
      );
      return rows[0] ? toApi(rows[0]) : null;
    },

    async update(id, patch) {
      const sets = [];
      const values = [id, ownerLogin];
      if (patch.title !== undefined) {
        values.push(patch.title);
        sets.push(`title = $${values.length}`);
      }
      if (patch.done !== undefined) {
        values.push(patch.done);
        sets.push(`done = $${values.length}`);
      }
      const { rows } = await pool.query(
        `UPDATE ${table} SET ${sets.join(', ')}
         WHERE id = $1 AND owner_login = $2
         RETURNING ${COLUMNS}`,
        values,
      );
      return rows[0] ? toApi(rows[0]) : null;
    },

    async remove(id) {
      const { rowCount } = await pool.query(
        `DELETE FROM ${table} WHERE id = $1 AND owner_login = $2`,
        [id, ownerLogin],
      );
      return rowCount > 0;
    },
  };
}

module.exports = { createPool, createTaskRepo, toApi };
