'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const {
  ValidationError,
  parseCreateBody,
  parsePatchBody,
  parseListQuery,
  parseId,
} = require('./validate');

class DbUnavailableError extends Error {}
class NotFoundError extends Error {}

/** Любая ошибка обращения к БД превращается в 503. */
async function db(operation) {
  try {
    return await operation();
  } catch (err) {
    console.error('[db]', err.code || '', err.message);
    throw new DbUnavailableError('База данных недоступна');
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function bearerAuth(expectedToken) {
  const expected = sha256(expectedToken);
  return (req, res, next) => {
    const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(req.get('authorization') || '');
    // Сравниваем хеши: длина одинаковая, время сравнения не зависит от токена.
    if (match && crypto.timingSafeEqual(sha256(match[1]), expected)) return next();
    res.set('WWW-Authenticate', 'Bearer realm="api"');
    return res.status(401).json({ error: 'Нужен правильный токен в Authorization: Bearer' });
  };
}

function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
  });
  next();
}

// Разбираем тело как JSON при любом Content-Type: всё, что не JSON-объект, → 400.
const jsonBody = express.json({ type: () => true, strict: true, limit: '16kb' });

function createApp({ config, repo }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(securityHeaders);

  app.get('/login', (req, res) => {
    res.type('text/plain').send(config.author.login);
  });

  const api = express.Router();
  api.use(bearerAuth(config.apiToken));

  api.get('/author', (req, res) => {
    res.json({ login: config.author.login, fullName: config.author.fullName });
  });

  api.post('/tasks', jsonBody, async (req, res) => {
    const input = parseCreateBody(req.body);
    const task = await db(() => repo.create({ id: crypto.randomUUID(), ...input }));
    res.status(201).json(task);
  });

  api.get('/tasks', async (req, res) => {
    const runId = parseListQuery(req.query);
    res.json(await db(() => repo.listByRun(runId)));
  });

  api.get('/tasks/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const task = await db(() => repo.get(id));
    if (!task) throw new NotFoundError('Дело не найдено');
    res.json(task);
  });

  api.patch('/tasks/:id', jsonBody, async (req, res) => {
    const id = parseId(req.params.id);
    const patch = parsePatchBody(req.body);
    const task = await db(() => repo.update(id, patch));
    if (!task) throw new NotFoundError('Дело не найдено');
    res.json(task);
  });

  api.delete('/tasks/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const removed = await db(() => repo.remove(id));
    if (!removed) throw new NotFoundError('Дело не найдено');
    res.status(204).end();
  });

  api.use((req, res) => {
    res.status(404).json({ error: 'Маршрут не найден' });
  });

  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    if (err instanceof DbUnavailableError) return res.status(503).json({ error: err.message });
    if (err.type === 'entity.too.large') {
      return res.status(400).json({ error: 'Слишком большое тело запроса' });
    }
    if (err.type === 'entity.parse.failed' || (err.status >= 400 && err.status < 500)) {
      return res.status(400).json({ error: 'Ошибочный JSON в теле запроса' });
    }
    console.error('[app]', err);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });

  app.use('/api', api);
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

  return app;
}

module.exports = { createApp };
