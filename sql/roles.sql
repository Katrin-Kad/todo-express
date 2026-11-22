-- Отдельные ограниченные роли: для приложения (todo_app) и для проверяющего (todo_reviewer).
-- Права: только SELECT/INSERT/UPDATE/DELETE на учебную таблицу tasks.
-- Запуск через psql (пароль не храните в репозитории):
--   psql "$DATABASE_ADMIN_URL" -v schema=todo -v role=todo_reviewer -v password='<пароль>' -f sql/roles.sql
-- или: npm run db:role -- todo_reviewer  (пароль сгенерируется и выведется один раз)

CREATE ROLE :"role" LOGIN PASSWORD :'password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 5;

GRANT USAGE ON SCHEMA :"schema" TO :"role";
GRANT SELECT, INSERT, UPDATE, DELETE ON :"schema".tasks TO :"role";
CREATE POLICY :"role" ON :"schema".tasks TO :"role" USING (true) WITH CHECK (true);
