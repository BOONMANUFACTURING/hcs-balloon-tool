import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// A drawing session (one PDF file = one session)
export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  partNumber: text("part_number").notNull().default(""),
  pdfFileName: text("pdf_file_name").notNull(),
  pdfDataBase64: text("pdf_data_base64").notNull(), // store the PDF as base64
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Individual balloon entries
export const balloons = sqliteTable("balloons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  balloonNumber: text("balloon_number").notNull(), // e.g. "1", "1.1", "2"
  pageNumber: integer("page_number").notNull().default(1),
  // Position as percentage of page width/height (0-100) — balloon circle center
  xPercent: real("x_percent").notNull(),
  yPercent: real("y_percent").notNull(),
  // Anchor point = right edge of crop (where leader line starts)
  anchorXPercent: real("anchor_x_percent").notNull().default(0),
  anchorYPercent: real("anchor_y_percent").notNull().default(0),
  // AMAT Notes & Dimensions fields
  rowType: text("row_type").notNull().default("DIMENSION"), // NOTE or DIMENSION
  description: text("description").notNull().default(""),
  standardNote: text("standard_note").notNull().default(""),   // for NOTE rows (col E)
  gdtType: text("gdt_type").notNull().default(""),             // for DIMENSION rows (col F)
  nominalValue: text("nominal_value").notNull().default(""),
  lowerTolerance: text("lower_tolerance").notNull().default(""),
  upperTolerance: text("upper_tolerance").notNull().default(""),
  actualValue: text("actual_value").notNull().default(""),
  materialCondition: text("material_condition").notNull().default("NONE"),
  tool: text("tool").notNull().default(""),
  calibrationDueDate: text("calibration_due_date").notNull().default(""),
  firPqr: text("fir_pqr").notNull().default(""),
});

export const insertSessionSchema = createInsertSchema(sessions).omit({ id: true });
export const insertBalloonSchema = createInsertSchema(balloons).omit({ id: true });

export type Session = typeof sessions.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Balloon = typeof balloons.$inferSelect;
export type InsertBalloon = z.infer<typeof insertBalloonSchema>;
