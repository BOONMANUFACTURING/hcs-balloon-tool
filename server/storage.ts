import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { sessions, balloons, type Session, type InsertSession, type Balloon, type InsertBalloon } from "@shared/schema";
import { join } from "path";

// Use process.cwd() so data.db is always next to where npm run dev/start is run from
const DB_PATH = join(process.cwd(), "data.db");

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
export const db = drizzle(sqlite);

// Auto-create tables if they don't exist
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
    anchor_x_percent REAL NOT NULL DEFAULT 0,
    anchor_y_percent REAL NOT NULL DEFAULT 0,
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

// Migrations: safe to run repeatedly (ALTER TABLE ignores if column exists)
try { sqlite.exec(`ALTER TABLE balloons ADD COLUMN anchor_x_percent REAL NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE balloons ADD COLUMN anchor_y_percent REAL NOT NULL DEFAULT 0`); } catch {}
try { sqlite.exec(`ALTER TABLE sessions ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'`); } catch {}

export interface IStorage {
  getAllSessions(): Session[];
  getSession(id: number): Session | undefined;
  createSession(data: InsertSession): Session;
  updateSession(id: number, data: Partial<InsertSession>): Session | undefined;
  deleteSession(id: number): void;
  getBalloonsBySession(sessionId: number): Balloon[];
  getBalloon(id: number): Balloon | undefined;
  createBalloon(data: InsertBalloon): Balloon;
  updateBalloon(id: number, data: Partial<InsertBalloon>): Balloon | undefined;
  deleteBalloon(id: number): void;
  deleteBalloonsBySession(sessionId: number): void;
}

export class DatabaseStorage implements IStorage {
  getAllSessions(): Session[] {
    return db.select().from(sessions).all();
  }
  getSession(id: number): Session | undefined {
    return db.select().from(sessions).where(eq(sessions.id, id)).get();
  }
  createSession(data: InsertSession): Session {
    return db.insert(sessions).values(data).returning().get();
  }
  updateSession(id: number, data: Partial<InsertSession>): Session | undefined {
    return db.update(sessions).set(data).where(eq(sessions.id, id)).returning().get();
  }
  deleteSession(id: number): void {
    db.delete(sessions).where(eq(sessions.id, id)).run();
  }
  getBalloonsBySession(sessionId: number): Balloon[] {
    return db.select().from(balloons).where(eq(balloons.sessionId, sessionId)).all();
  }
  getBalloon(id: number): Balloon | undefined {
    return db.select().from(balloons).where(eq(balloons.id, id)).get();
  }
  createBalloon(data: InsertBalloon): Balloon {
    return db.insert(balloons).values(data).returning().get();
  }
  updateBalloon(id: number, data: Partial<InsertBalloon>): Balloon | undefined {
    return db.update(balloons).set(data).where(eq(balloons.id, id)).returning().get();
  }
  deleteBalloon(id: number): void {
    db.delete(balloons).where(eq(balloons.id, id)).run();
  }
  deleteBalloonsBySession(sessionId: number): void {
    db.delete(balloons).where(eq(balloons.sessionId, sessionId)).run();
  }
}

export const storage = new DatabaseStorage();
