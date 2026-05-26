import Database from "better-sqlite3";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    part_number TEXT NOT NULL DEFAULT '',
    pdf_file_name TEXT NOT NULL,
    pdf_data_base64 TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS balloons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    balloon_number TEXT NOT NULL,
    page_number INTEGER NOT NULL DEFAULT 1,
    x_percent REAL NOT NULL,
    y_percent REAL NOT NULL,
    row_type TEXT NOT NULL DEFAULT 'DIMENSION',
    description TEXT NOT NULL DEFAULT '',
    standard_note TEXT NOT NULL DEFAULT '',
    gdt_type TEXT NOT NULL DEFAULT '',
    nominal_value TEXT NOT NULL DEFAULT '',
    lower_tolerance TEXT NOT NULL DEFAULT '',
    upper_tolerance TEXT NOT NULL DEFAULT '',
    actual_value TEXT NOT NULL DEFAULT '',
    material_condition TEXT NOT NULL DEFAULT 'NONE',
    tool TEXT NOT NULL DEFAULT '',
    calibration_due_date TEXT NOT NULL DEFAULT '',
    fir_pqr TEXT NOT NULL DEFAULT ''
  );
`);

console.log("Database migrated successfully.");
sqlite.close();
