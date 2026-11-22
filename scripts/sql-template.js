'use strict';

const { escapeIdentifier, escapeLiteral } = require('pg');

/**
 * Подставляет psql-переменные :"name" (идентификатор) и :'name' (строка),
 * чтобы один и тот же .sql-файл работал и через psql -v, и из Node.js.
 */
function renderSql(sql, vars) {
  const value = (name) => {
    if (vars[name] === undefined) throw new Error(`Нет значения для переменной ${name}`);
    return String(vars[name]);
  };
  return sql
    .replace(/:"(\w+)"/g, (_, name) => escapeIdentifier(value(name)))
    .replace(/:'(\w+)'/g, (_, name) => escapeLiteral(value(name)));
}

module.exports = { renderSql };
