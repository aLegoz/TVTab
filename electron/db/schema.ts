export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS departments (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS employees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT    NOT NULL,
  position      TEXT    NOT NULL DEFAULT '',
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  rate_type     TEXT    NOT NULL CHECK(rate_type IN ('hourly','monthly')),
  rate          REAL    NOT NULL DEFAULT 0,
  hired_date    TEXT    NOT NULL DEFAULT '',
  is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS timesheet_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date        TEXT    NOT NULL,
  code        TEXT    NOT NULL DEFAULT 'Я',
  hours       REAL    NOT NULL DEFAULT 8,
  UNIQUE(employee_id, date)
);

CREATE TABLE IF NOT EXISTS salary_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id    INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_from TEXT    NOT NULL,
  rate_type      TEXT    NOT NULL CHECK(rate_type IN ('hourly','monthly')),
  rate           REAL    NOT NULL,
  note           TEXT    NOT NULL DEFAULT '',
  UNIQUE(employee_id, effective_from)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS holidays (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS workdays (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS month_settings (
  year  INTEGER NOT NULL,
  month INTEGER NOT NULL,
  key   TEXT    NOT NULL,
  value TEXT    NOT NULL,
  PRIMARY KEY (year, month, key)
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('mode', 'local');
INSERT OR IGNORE INTO settings (key, value) VALUES ('serverUrl', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('workHoursPerDay', '8');
INSERT OR IGNORE INTO settings (key, value) VALUES ('scheduleStart', '08:30');
INSERT OR IGNORE INTO settings (key, value) VALUES ('scheduleLunchStart', '12:30');
INSERT OR IGNORE INTO settings (key, value) VALUES ('scheduleLunchEnd', '13:00');
INSERT OR IGNORE INTO settings (key, value) VALUES ('scheduleEnd', '17:00');
INSERT OR IGNORE INTO settings (key, value) VALUES ('overtimeCoeff', '1.5');

-- Миграция: перенести текущие ставки сотрудников в историю (безопасно повторно запускать)
INSERT OR IGNORE INTO salary_history (employee_id, effective_from, rate_type, rate)
SELECT id, COALESCE(NULLIF(hired_date,''), '2000-01-01'), rate_type, rate
FROM employees WHERE rate > 0;
`
