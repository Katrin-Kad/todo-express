'use strict';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TITLE_MAX = 200;

class ValidationError extends Error {}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rejectExtraFields(body, allowed) {
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    throw new ValidationError(`Лишние поля: ${extra.join(', ')}`);
  }
}

/** title: строка, после trim от 1 до 200 символов (считаются кодовые точки Unicode). */
function parseTitle(value) {
  if (typeof value !== 'string') throw new ValidationError('title должен быть строкой');
  const title = value.trim();
  if (title.includes('\u0000') || !title.isWellFormed()) {
    throw new ValidationError('title содержит недопустимые символы');
  }
  const length = [...title].length;
  if (length < 1 || length > TITLE_MAX) {
    throw new ValidationError(`title после trim должен содержать от 1 до ${TITLE_MAX} символов`);
  }
  return title;
}

function parseRunId(value) {
  if (typeof value !== 'string' || !RUN_ID_RE.test(value)) {
    throw new ValidationError('runId: 1–64 символа из A–Z, a–z, 0–9, «_», «-»');
  }
  return value;
}

function parseCreateBody(body) {
  if (!isPlainObject(body)) throw new ValidationError('Тело запроса должно быть JSON-объектом');
  rejectExtraFields(body, ['title', 'runId']);
  if (!('title' in body)) throw new ValidationError('Не передано поле title');
  if (!('runId' in body)) throw new ValidationError('Не передано поле runId');
  return { title: parseTitle(body.title), runId: parseRunId(body.runId) };
}

function parsePatchBody(body) {
  if (!isPlainObject(body)) throw new ValidationError('Тело запроса должно быть JSON-объектом');
  rejectExtraFields(body, ['title', 'done']);
  if (Object.keys(body).length === 0) throw new ValidationError('Нужно передать title и/или done');
  const patch = {};
  if ('title' in body) patch.title = parseTitle(body.title);
  if ('done' in body) {
    if (typeof body.done !== 'boolean') throw new ValidationError('done должен быть boolean');
    patch.done = body.done;
  }
  return patch;
}

function parseListQuery(query) {
  if (query.runId === undefined) throw new ValidationError('Не передан параметр runId');
  return parseRunId(query.runId);
}

function parseId(value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new ValidationError('id должен быть UUID');
  }
  return value.toLowerCase();
}

module.exports = {
  ValidationError,
  parseCreateBody,
  parsePatchBody,
  parseListQuery,
  parseId,
  RUN_ID_RE,
  TITLE_MAX,
};
