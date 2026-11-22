-- Схема учебной таблицы tasks (PostgreSQL 13+).
-- Запуск через psql:
--   psql "$DATABASE_ADMIN_URL" -v schema=todo -v owner_login=<логин Moodle> -f sql/schema.sql
-- или: npm run db:init  (значения берутся из .env)
-- Скрипт идемпотентный: повторный запуск данные не удаляет.

CREATE SCHEMA IF NOT EXISTS :"schema";

CREATE TABLE IF NOT EXISTS :"schema".tasks (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_login varchar(64)  NOT NULL,
  title       varchar(200) NOT NULL CHECK (btrim(title) <> ''),
  done        boolean      NOT NULL DEFAULT false,
  run_id      varchar(64)  NOT NULL CHECK (run_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_owner_run_idx
  ON :"schema".tasks (owner_login, run_id, created_at);

-- Строки, добавленные напрямую в БД без owner_login, достаются автору.
ALTER TABLE :"schema".tasks ALTER COLUMN owner_login SET DEFAULT :'owner_login';

ALTER TABLE :"schema".tasks ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE :"schema".tasks IS 'Учебная таблица: список дел (итоговое задание Express + БД)';
