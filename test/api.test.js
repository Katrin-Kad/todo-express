'use strict';

// Интеграционные тесты HTTP-контракта на настоящей БД.
// Нужны .env (как для запуска) и, по желанию, TEST_REVIEWER_URL — строка подключения
// роли проверяющего для «независимых» изменений напрямую в БД.
//   npm test
require('dotenv').config({ quiet: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool, escapeIdentifier } = require('pg');
const { loadConfig } = require('../src/config');
const { createPool, createTaskRepo } = require('../src/db');
const { createApp } = require('../src/app');

const config = loadConfig();
const RUN = `test_${randomUUID()}`;
const LIMIT_RUN = RUN.padEnd(64, '9');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const table = `${escapeIdentifier(config.db.schema)}.tasks`;

let server;
let base;
let pool;
let direct; // независимое подключение к той же БД

function start(appRepo) {
  return new Promise((resolve) => {
    const srv = createApp({ config, repo: appRepo }).listen(0, () => resolve(srv));
  });
}

async function call(method, path, { body, token = config.apiToken, raw, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (token !== null) init.headers.Authorization = `Bearer ${token}`;
  if (raw !== undefined) {
    init.body = raw;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(base + path, init);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: res.status, type: res.headers.get('content-type') || '', text, json };
}

function assertJsonError(res, status) {
  assert.equal(res.status, status, res.text);
  assert.match(res.type, /^application\/json/);
  assert.equal(typeof res.json.error, 'string');
  assert.ok(res.json.error.length > 0);
}

before(async () => {
  pool = createPool(config.db);
  server = await start(createTaskRepo(pool, config.db.schema, config.author.login));
  base = `http://127.0.0.1:${server.address().port}`;
  direct = new Pool({
    connectionString: process.env.TEST_REVIEWER_URL || config.db.connectionString,
    ssl: config.db.ssl,
  });
});

after(async () => {
  try {
    await direct.query(
      `DELETE FROM ${table} WHERE run_id = ANY($1::text[])`,
      [[RUN, LIMIT_RUN, `${RUN}_other`, `${RUN}_direct`]],
    );
  } finally {
    await direct.end();
    server.close();
    await pool.end();
  }
});

test('GET /login/ — text/plain без токена', async () => {
  const res = await call('GET', '/login/', { token: null });
  assert.equal(res.status, 200);
  assert.match(res.type, /^text\/plain/);
  assert.equal(res.text, config.author.login);
});

test('API без токена или с неверным токеном — 401', async () => {
  for (const token of [null, 'wrong-token', '']) {
    assertJsonError(await call('GET', '/api/author/', { token }), 401);
  }
  assertJsonError(await call('POST', '/api/tasks/', { token: null, raw: '{oops' }), 401);
  assertJsonError(await call('GET', '/api/nope/', { token: null }), 401);
  const basic = await call('GET', '/api/author/', {
    token: null, headers: { Authorization: `Basic ${config.apiToken}` },
  });
  assertJsonError(basic, 401);
});

test('GET /api/author/', async () => {
  const res = await call('GET', '/api/author/');
  assert.equal(res.status, 200);
  assert.match(res.type, /^application\/json/);
  assert.deepEqual(res.json, { login: config.author.login, fullName: config.author.fullName });
  const lower = await call('GET', '/api/author/', {
    token: null, headers: { Authorization: `bearer ${config.apiToken}` },
  });
  assert.equal(lower.status, 200);
});

test('POST /api/tasks/ — 201 и созданное дело', async () => {
  const res = await call('POST', '/api/tasks/', { body: { title: '  Купить молоко  ', runId: RUN } });
  assert.equal(res.status, 201);
  assert.match(res.type, /^application\/json/);
  const t = res.json;
  assert.deepEqual(Object.keys(t).sort(), ['createdAt', 'done', 'id', 'ownerLogin', 'runId', 'title']);
  assert.match(t.id, UUID_RE);
  assert.equal(t.ownerLogin, config.author.login);
  assert.equal(t.title, 'Купить молоко');
  assert.equal(t.done, false);
  assert.equal(t.runId, RUN);
  assert.match(t.createdAt, ISO_UTC_RE);
  assert.ok(Math.abs(Date.parse(t.createdAt) - Date.now()) < 60_000);

  const { rows } = await direct.query(`SELECT * FROM ${table} WHERE id = $1`, [t.id]);
  assert.equal(rows.length, 1, 'запись есть в БД');
  assert.equal(rows[0].title, 'Купить молоко');
  assert.equal(rows[0].owner_login, config.author.login);
});

test('POST: граница 200 символов считается по символам, а не байтам', async () => {
  const ok = await call('POST', '/api/tasks/', { body: { title: '🙂'.repeat(200), runId: RUN } });
  assert.equal(ok.status, 201);
  assertJsonError(await call('POST', '/api/tasks/', { body: { title: 'я'.repeat(201), runId: RUN } }), 400);
});

test('POST: ошибки валидации — 400', async () => {
  const cases = [
    { title: 'x' },
    { runId: RUN },
    { title: 'x', runId: RUN, done: true },
    { title: 'x', runId: RUN, ownerLogin: 'hacker' },
    { title: 'x', runId: RUN, id: '00000000-0000-4000-8000-000000000000' },
    { title: 123, runId: RUN },
    { title: null, runId: RUN },
    { title: '   ', runId: RUN },
    { title: 'x\u0000y', runId: RUN },
    { title: '\ud800', runId: RUN },
    { title: 'x', runId: 'плохой' },
    { title: 'x', runId: 'a b' },
    { title: 'x', runId: '' },
    { title: 'x', runId: 'a'.repeat(65) },
    { title: 'x', runId: 42 },
    {},
  ];
  for (const body of cases) {
    assertJsonError(await call('POST', '/api/tasks/', { body }), 400);
  }
  for (const raw of ['{"title":', '[]', '"str"', '42', 'null', 'title=x&runId=y', '']) {
    assertJsonError(
      await call('POST', '/api/tasks/', { raw, headers: { 'Content-Type': 'application/json' } }),
      400,
    );
  }
  assertJsonError(await call('POST', '/api/tasks/', {
    body: { title: 'x'.repeat(17_000), runId: RUN },
  }), 400);
  const okRunId = await call('POST', '/api/tasks/', { body: { title: 'x', runId: LIMIT_RUN } });
  assert.equal(okRunId.status, 201);
  await call('DELETE', `/api/tasks/${okRunId.json.id}/`);
});

test('GET /api/tasks/?runId — массив дел автора с этим runId', async () => {
  const other = `${RUN}_other`;
  const a = (await call('POST', '/api/tasks/', { body: { title: 'A', runId: other } })).json;
  const b = (await call('POST', '/api/tasks/', { body: { title: 'B', runId: other } })).json;
  // Чужое дело в той же таблице не должно попасть в выдачу.
  await direct.query(
    `INSERT INTO ${table} (owner_login, title, run_id) VALUES ('someone_else', 'чужое', $1)`,
    [other],
  );

  const res = await call('GET', `/api/tasks/?runId=${other}`);
  assert.equal(res.status, 200);
  assert.match(res.type, /^application\/json/);
  assert.deepEqual(res.json.map((t) => t.id), [a.id, b.id]);

  const empty = await call('GET', `/api/tasks/?runId=${RUN}_nothing`);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json, []);
});

test('GET /api/tasks/ — без runId или с неверным runId — 400', async () => {
  assertJsonError(await call('GET', '/api/tasks/'), 400);
  assertJsonError(await call('GET', '/api/tasks/?runId='), 400);
  assertJsonError(await call('GET', '/api/tasks/?runId=a%20b'), 400);
  assertJsonError(await call('GET', `/api/tasks/?runId=${RUN}&runId=x`), 400);
});

test('GET /api/tasks/:id/', async () => {
  const t = (await call('POST', '/api/tasks/', { body: { title: 'Одно', runId: RUN } })).json;
  const res = await call('GET', `/api/tasks/${t.id}/`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, t);
  const upper = await call('GET', `/api/tasks/${t.id.toUpperCase()}/`);
  assert.equal(upper.status, 200);
  assertJsonError(await call('GET', '/api/tasks/2b3f8c1e-0000-4000-8000-000000000000/'), 404);
  assertJsonError(await call('GET', '/api/tasks/not-a-uuid/'), 400);
  assertJsonError(await call('GET', '/api/tasks/2b3f8c1e00004000800000000000000/'), 400);
});

test('PATCH /api/tasks/:id/', async () => {
  const t = (await call('POST', '/api/tasks/', { body: { title: 'Старое', runId: RUN } })).json;

  const r1 = await call('PATCH', `/api/tasks/${t.id}/`, { body: { title: '  Новое ' } });
  assert.equal(r1.status, 200);
  assert.equal(r1.json.title, 'Новое');
  assert.equal(r1.json.done, false);

  const r2 = await call('PATCH', `/api/tasks/${t.id}/`, { body: { done: true } });
  assert.equal(r2.status, 200);
  assert.equal(r2.json.done, true);
  assert.equal(r2.json.title, 'Новое');

  const r3 = await call('PATCH', `/api/tasks/${t.id}/`, { body: { title: 'Оба', done: false } });
  assert.deepEqual([r3.json.title, r3.json.done], ['Оба', false]);
  assert.equal(r3.json.createdAt, t.createdAt);
  assert.equal(r3.json.id, t.id);

  const { rows } = await direct.query(`SELECT title, done FROM ${table} WHERE id = $1`, [t.id]);
  assert.deepEqual(rows[0], { title: 'Оба', done: false });

  for (const body of [
    {}, { done: 'true' }, { done: 1 }, { done: null }, { title: '' }, { title: 5 },
    { runId: 'x' }, { title: 'x', id: t.id }, { createdAt: '2020-01-01T00:00:00Z' },
  ]) {
    assertJsonError(await call('PATCH', `/api/tasks/${t.id}/`, { body }), 400);
  }
  assertJsonError(await call('PATCH', `/api/tasks/${t.id}/`, { raw: '{bad json' }), 400);
  assertJsonError(await call('PATCH', '/api/tasks/2b3f8c1e-0000-4000-8000-000000000000/', { body: { done: true } }), 404);
  assertJsonError(await call('PATCH', '/api/tasks/123/', { body: { done: true } }), 400);
});

test('DELETE /api/tasks/:id/ — 204 без тела, затем 404', async () => {
  const t = (await call('POST', '/api/tasks/', { body: { title: 'Удалить', runId: RUN } })).json;
  const res = await call('DELETE', `/api/tasks/${t.id}/`);
  assert.equal(res.status, 204);
  assert.equal(res.text, '');
  const { rowCount } = await direct.query(`SELECT 1 FROM ${table} WHERE id = $1`, [t.id]);
  assert.equal(rowCount, 0, 'строка удалена из БД');
  assertJsonError(await call('DELETE', `/api/tasks/${t.id}/`), 404);
  assertJsonError(await call('GET', `/api/tasks/${t.id}/`), 404);
  assertJsonError(await call('DELETE', '/api/tasks/zzz/'), 400);
});

test('Независимые изменения в БД сразу видны через API', async () => {
  const run = `${RUN}_direct`;
  // Проверяющий вставляет строку только с title и run_id: остальное — значения по умолчанию.
  const { rows } = await direct.query(
    `INSERT INTO ${table} (title, run_id) VALUES ('Из БД', $1) RETURNING id`,
    [run],
  );
  const id = rows[0].id;

  let res = await call('GET', `/api/tasks/?runId=${run}`);
  assert.equal(res.json.length, 1);
  assert.equal(res.json[0].id, id);
  assert.equal(res.json[0].ownerLogin, config.author.login);
  assert.equal(res.json[0].done, false);
  assert.match(res.json[0].createdAt, ISO_UTC_RE);

  await direct.query(`UPDATE ${table} SET title = 'Изменено в БД', done = true WHERE id = $1`, [id]);
  res = await call('GET', `/api/tasks/${id}/`);
  assert.equal(res.json.title, 'Изменено в БД');
  assert.equal(res.json.done, true);

  await direct.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  assertJsonError(await call('GET', `/api/tasks/${id}/`), 404);
  assertJsonError(await call('PATCH', `/api/tasks/${id}/`, { body: { done: false } }), 404);
  assertJsonError(await call('DELETE', `/api/tasks/${id}/`), 404);
  res = await call('GET', `/api/tasks/?runId=${run}`);
  assert.deepEqual(res.json, []);
});

test('Данные переживают перезапуск приложения', async () => {
  const t = (await call('POST', '/api/tasks/', { body: { title: 'Постоянное', runId: RUN } })).json;
  const pool2 = createPool(config.db);
  const server2 = await start(createTaskRepo(pool2, config.db.schema, config.author.login));
  try {
    const res = await fetch(`http://127.0.0.1:${server2.address().port}/api/tasks/${t.id}/`, {
      headers: { Authorization: `Bearer ${config.apiToken}` },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), t);
  } finally {
    server2.close();
    await pool2.end();
  }
});

test('Ошибка БД — 503 с JSON', async () => {
  const deadPool = createPool({
    ...config.db,
    connectionString: 'postgresql://nobody:nothing@127.0.0.1:1/none',
    ssl: false,
  });
  const deadServer = await start(createTaskRepo(deadPool, config.db.schema, config.author.login));
  const deadBase = `http://127.0.0.1:${deadServer.address().port}`;
  const auth = { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'application/json' };
  try {
    const requests = [
      ['GET', `/api/tasks/?runId=${RUN}`],
      ['POST', '/api/tasks/', JSON.stringify({ title: 'x', runId: RUN })],
      ['GET', '/api/tasks/2b3f8c1e-0000-4000-8000-000000000000/'],
      ['PATCH', '/api/tasks/2b3f8c1e-0000-4000-8000-000000000000/', '{"done":true}'],
      ['DELETE', '/api/tasks/2b3f8c1e-0000-4000-8000-000000000000/'],
    ];
    for (const [method, path, body] of requests) {
      const res = await fetch(deadBase + path, { method, headers: auth, body });
      assert.equal(res.status, 503, `${method} ${path}`);
      assert.match(res.headers.get('content-type'), /^application\/json/);
      assert.equal(typeof (await res.json()).error, 'string');
    }
    // Валидация срабатывает раньше обращения к БД.
    const bad = await fetch(`${deadBase}/api/tasks/`, { method: 'POST', headers: auth, body: '{}' });
    assert.equal(bad.status, 400);
  } finally {
    deadServer.close();
    await deadPool.end();
  }
});

test('Неизвестный маршрут /api/ — 404 JSON; интерфейс отдается без токена', async () => {
  assertJsonError(await call('GET', '/api/unknown/'), 404);
  assertJsonError(await call('PUT', '/api/tasks/'), 404);
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.match(await page.text(), /<html lang="ru">/);
});

test('Роль проверяющего ограничена таблицей tasks', { skip: !process.env.TEST_REVIEWER_URL }, async () => {
  const { rows: [rights] } = await direct.query(
    `SELECT
       role.rolsuper AS superuser,
       role.rolcreatedb AS creates_database,
       role.rolcreaterole AS creates_role,
       pg_has_role(tasks.relowner, 'MEMBER') AS owns_table,
       has_schema_privilege($1, 'CREATE') AS creates_in_schema,
       has_table_privilege($2, 'TRUNCATE') AS truncates_table
     FROM pg_roles AS role
     CROSS JOIN pg_class AS tasks
     WHERE role.rolname = current_user AND tasks.oid = $2::regclass`,
    [config.db.schema, table],
  );
  assert.deepEqual(rights, {
    superuser: false,
    creates_database: false,
    creates_role: false,
    owns_table: false,
    creates_in_schema: false,
    truncates_table: false,
  });
});
