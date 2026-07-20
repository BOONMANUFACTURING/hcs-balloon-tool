import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertSessionSchema, insertBalloonSchema } from "@shared/schema";
import { z } from "zod";
import multer from "multer";
import { GoogleGenerativeAI } from "@google/generative-ai";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const EXTRACTION_SYSTEM_PROMPT = `You are an engineering drawing OCR expert for HCS Engineering (Singapore), extracting balloon dimensions from AMAT (Applied Materials) drawings into FAI Excel format.

Given a cropped image from an engineering drawing, extract the feature information and return ONLY valid JSON with these fields:

{
  "rawReading": "describe exactly what you see in the crop",
  "rowType": "NOTE" or "DIMENSION",
  "description": "Col D value — e.g. '3X DIAMETER', 'WELDING AND GRIND FLUSH', 'PERPENDICULARITY REFER TO DATUM B'",
  "gdtType": "Col F value — e.g. 'POSITION', 'ANGULARITY', 'DIAMETER', 'PERPENDICULARITY', 'FLATNESS', 'PARALLELISM', or blank",
  "nominalValue": "Col G — numeric value for DIMENSION rows, 'In Compliance' for NOTE rows",
  "confidence": "high", "medium", or "low"
}

RULES (AMAT-specific):
- Ø symbol = DIAMETER (prefix with quantity e.g. '4X DIAMETER')
- Linear distance = DISTANCE
- Hole spacing = HOLE DISTANCE  
- R prefix = RADIUS
- Degree ° = ANGULARITY
- ⊕ frame = TRUE POSITION (rowType=DIMENSION, gdtType=POSITION)
- ⊥ = PERPENDICULARITY
- // = PARALLELISM
- Weld symbol (chevron/flag) = WELDING / WELDING AND GRINDING / WELDING AND GRIND FLUSH (rowType=NOTE)
- Surface roughness triangle on surface = SURFACE ROUGHNESS (rowType=DIMENSION)
- Thread callout e.g. .250-20 UNC-2B = rowType=NOTE, description=exact thread spec
- Values in parentheses e.g. (39.966) = REFERENCE DIMENSION (rowType=NOTE)
- Boxed value = treat as regular DIMENSION (rowType=DIMENSION), extract the numeric value normally
- Triangle △ with number inside = ignore (general note reference)
- 1X is NEVER written — omit the quantity prefix for single features
- Quantity prefix: 2X, 3X, 4X etc before feature type
- nominalValue: for DIMENSION rows use numeric value only (e.g. '0.438', '45', '1.875')
- For NOTE rows: nominalValue = 'In Compliance'

Return ONLY the JSON object, no markdown, no explanation.`;

// ─── Gemini helper ────────────────────────────────────────────────────────────
// Normal search: Flash x2, pick best
// Deep search:   Pro   x2, pick best
async function geminiExtract(
  apiKey: string,
  modelName: string,   // "gemini-1.5-flash" or "gemini-1.5-pro"
  systemPrompt: string,
  userPrompt: string,
  imageBase64: string,
  mimeType: string
): Promise<any> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
  });

  const imagePart = {
    inlineData: { data: imageBase64, mimeType: mimeType as any },
  };

  const results: any[] = [];

  // Call twice — pick most confident / most complete result
  let lastError = "";
  for (let i = 0; i < 2; i++) {
    try {
      const result = await model.generateContent([userPrompt, imagePart]);
      const raw = result.response.text();
      const cleaned = raw.replace(/```json\n?|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      results.push(parsed);
    } catch (e: any) {
      lastError = e?.message || String(e);
      console.error(`[Gemini] Attempt ${i + 1} failed:`, lastError);
    }
  }

  if (results.length === 0) throw new Error(`Gemini failed: ${lastError}`);

  // Pick best: prefer "high" confidence, then most rows, then first
  const ranked = results.sort((a, b) => {
    const confScore = (r: any) => r.confidence === "high" ? 2 : r.confidence === "medium" ? 1 : 0;
    const rowScore  = (r: any) => Array.isArray(r.rows) ? r.rows.length : Array.isArray(r.notes) ? r.notes.length : 0;
    return (confScore(b) + rowScore(b)) - (confScore(a) + rowScore(a));
  });

  return ranked[0];
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // ─── Sessions ───────────────────────────────────────────────────────────────

  app.get("/api/sessions", (_req, res) => {
    const all = storage.getAllSessions().map(s => ({
      ...s,
      pdfDataBase64: undefined,
    }));
    res.json(all);
  });

  app.get("/api/sessions/:id", (req, res) => {
    const session = storage.getSession(Number(req.params.id));
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json(session);
  });

  app.post("/api/sessions/upload", upload.single("pdf"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const { name, partNumber } = req.body;
    if (!name) return res.status(400).json({ error: "Session name required" });

    const pdfDataBase64 = req.file.buffer.toString("base64");
    const now = new Date().toISOString();
    const session = storage.createSession({
      name,
      partNumber: partNumber || "",
      pdfFileName: req.file.originalname,
      pdfDataBase64,
      createdAt: now,
      updatedAt: now,
    });
    res.json(session);
  });

  app.patch("/api/sessions/:id", (req, res) => {
    const parsed = insertSessionSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const updated = storage.updateSession(Number(req.params.id), {
      ...parsed.data,
      updatedAt: new Date().toISOString(),
    });
    if (!updated) return res.status(404).json({ error: "Session not found" });
    res.json(updated);
  });

  // Session settings — GET and PATCH the settingsJson blob
  app.get("/api/sessions/:id/settings", (req, res) => {
    const session = storage.getSession(Number(req.params.id));
    if (!session) return res.status(404).json({ error: "Session not found" });
    try {
      res.json(JSON.parse(session.settingsJson || "{}"));
    } catch {
      res.json({});
    }
  });

  app.patch("/api/sessions/:id/settings", (req, res) => {
    const session = storage.getSession(Number(req.params.id));
    if (!session) return res.status(404).json({ error: "Session not found" });
    let current: Record<string, unknown> = {};
    try { current = JSON.parse(session.settingsJson || "{}"); } catch {}
    const merged = { ...current, ...req.body };
    const updated = storage.updateSession(Number(req.params.id), {
      settingsJson: JSON.stringify(merged),
      updatedAt: new Date().toISOString(),
    });
    if (!updated) return res.status(404).json({ error: "Session not found" });
    res.json(merged);
  });

  // Upload Tool Master List Excel → parse into toolCalMap, store in session settings
  app.post("/api/sessions/:id/upload-tool-master", upload.single("file"), async (req, res) => {
    const session = storage.getSession(Number(req.params.id));
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(req.file.buffer);

      // Find the Tool Master List sheet (by name or first sheet)
      const ws = wb.getWorksheet("Tool Master List") || wb.worksheets[0];
      if (!ws) return res.status(400).json({ error: "No worksheet found in uploaded file" });

      // Parse: Col A = Tool Name, Col B = Description/ID, Col C = Expiration Date
      // Combined key = "Tool Name - Description" (matches _Lists!E format)
      const toolCalMap: Record<string, string> = {};
      ws.eachRow((row, rowNumber) => {
        if (rowNumber < 4) return; // skip header rows
        const toolName  = String(row.getCell(1).value || "").trim();
        const descId    = String(row.getCell(2).value || "").trim();
        const expDate   = row.getCell(3).value;
        const active    = String(row.getCell(4).value || "").trim();
        if (!toolName || !descId || !expDate) return;
        if (active.toLowerCase() === "no") return; // skip inactive tools

        // Format date: exceljs may return Date object or string
        let dateStr = "";
        if (expDate instanceof Date) {
          const m = String(expDate.getMonth() + 1).padStart(2, "0");
          const d = String(expDate.getDate()).padStart(2, "0");
          const y = expDate.getFullYear();
          dateStr = `${m}/${d}/${y}`;
        } else {
          dateStr = String(expDate).trim();
        }

        const key = `${toolName} - ${descId}`;
        toolCalMap[key] = dateStr;
      });

      // Merge into existing settings
      let current: Record<string, unknown> = {};
      try { current = JSON.parse(session.settingsJson || "{}"); } catch {}
      const merged = { ...current, toolCalMap };
      storage.updateSession(Number(req.params.id), {
        settingsJson: JSON.stringify(merged),
        updatedAt: new Date().toISOString(),
      });

      res.json({ ok: true, toolCount: Object.keys(toolCalMap).length, toolCalMap });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/sessions/:id", (req, res) => {
    storage.deleteBalloonsBySession(Number(req.params.id));
    storage.deleteSession(Number(req.params.id));
    res.json({ ok: true });
  });

  // ─── Balloons ───────────────────────────────────────────────────────────────

  app.get("/api/sessions/:id/balloons", (req, res) => {
    const balloons = storage.getBalloonsBySession(Number(req.params.id));
    res.json(balloons);
  });

  app.post("/api/sessions/:id/balloons", (req, res) => {
    const parsed = insertBalloonSchema.safeParse({ ...req.body, sessionId: Number(req.params.id) });
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const balloon = storage.createBalloon(parsed.data);
    res.json(balloon);
  });

  app.patch("/api/balloons/:id", (req, res) => {
    const parsed = insertBalloonSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const updated = storage.updateBalloon(Number(req.params.id), parsed.data);
    if (!updated) return res.status(404).json({ error: "Balloon not found" });
    res.json(updated);
  });

  app.delete("/api/balloons/:id", (req, res) => {
    storage.deleteBalloon(Number(req.params.id));
    res.json({ ok: true });
  });

  // ─── AI Extraction ──────────────────────────────────────────────────────────

  app.post("/api/extract", upload.single("crop"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No crop image provided" });

    const apiKey   = req.headers["x-gemini-key"]   as string || process.env.GEMINI_API_KEY;
    const modelId  = req.headers["x-gemini-model"] as string || "gemini-1.5-flash";

    if (!apiKey) {
      return res.json({
        rawReading: "MOCK MODE — no Gemini API key configured. Enter your API key in Settings to enable real extraction.",
        rowType: "DIMENSION",
        description: "DISTANCE",
        gdtType: "",
        nominalValue: "0.000",
        confidence: "low",
        mock: true,
      });
    }

    try {
      const base64Image = req.file.buffer.toString("base64");
      const mimeType    = req.file.mimetype || "image/png";
      const userPrompt  = `You are a senior semiconductor equipment manufacturing engineer at HCS Engineering (Singapore), specialising in AMAT (Applied Materials) FAI drawings. Examine this engineering drawing crop with extreme care and precision — as if signing off on a first-article inspection report. Extract the feature information accurately.`;

      const parsed = await geminiExtract(apiKey, modelId, EXTRACTION_SYSTEM_PROMPT, userPrompt, base64Image, mimeType);
      res.json(parsed);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Extraction failed" });
    }
  });

  // ─── Bulk Extract: Notes block ─────────────────────────────────────────────
  // Returns array of { noteNum, noteText } parsed from the crop image.

  app.post("/api/extract-notes", upload.single("crop"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No crop image provided" });
    const apiKey  = req.headers["x-gemini-key"]   as string || process.env.GEMINI_API_KEY;
    const modelId = req.headers["x-gemini-model"] as string || "gemini-1.5-flash";

    if (!apiKey) {
      return res.json({
        mock: true,
        notes: [
          { noteNum: 1, noteText: "APPLICABLE STANDARDS/SPECIFICATIONS: ASME Y14.5-2009" },
          { noteNum: 2, noteText: "INTERPRET DRAWING PER ASME Y14.5-2009" },
          { noteNum: 3, noteText: "REMOVE ALL BURRS AND SHARP EDGES" },
        ],
      });
    }

    try {
      const base64Image = req.file.buffer.toString("base64");
      const mimeType    = req.file.mimetype || "image/png";

      const systemPrompt = `You are a senior semiconductor equipment manufacturing engineer at HCS Engineering (Singapore), specialising in AMAT FAI drawings. You have expert-level precision in reading engineering drawing notes sections.`;

      const userPrompt = `This is a cropped image of the NOTES section from an AMAT engineering drawing.
Your job is to extract EVERY numbered note with extreme care. First, scan the entire image top to bottom and count ALL the note numbers you can see. Then extract each one completely.

Return ONLY valid JSON in this exact format:
{
  "notes": [
    { "noteNum": 1, "noteText": "full text of note 1", "yPercent": 5.2 },
    { "noteNum": 2, "noteText": "full text of note 2", "yPercent": 12.8 }
  ]
}

Rules:
- SCAN THE FULL IMAGE top to bottom. Do not stop early.
- Include ALL numbered notes — even short ones like "MINIMUM BEND RELIEF."
- noteText = the complete note text, EXCLUDING the leading number and period.
- yPercent = vertical position of the note number (0=top, 100=bottom).
- Notes with a triangle (△) symbol around their number ARE valid notes — include them.
- Do NOT include sub-items without their own note number.
- Return ONLY the JSON object, no markdown, no explanation.`;

      const parsed = await geminiExtract(apiKey, modelId, systemPrompt, userPrompt, base64Image, mimeType);
      res.json(parsed);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Notes extraction failed" });
    }
  });

  // ─── Bulk Extract: BOM table ─────────────────────────────────────────────────
  // Returns array of { itemNo, qty, description } parsed from the crop image.

  app.post("/api/extract-bom", upload.single("crop"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No crop image provided" });
    const apiKey  = req.headers["x-gemini-key"]   as string || process.env.GEMINI_API_KEY;
    const modelId = req.headers["x-gemini-model"] as string || "gemini-1.5-flash";

    if (!apiKey) {
      return res.json({
        mock: true,
        rows: [
          { itemNo: 1, qty: 1, description: "SHEET, ALUMINUM 5052 - H32, .125 THK OR 3.0MM THK" },
          { itemNo: 2, qty: 1, description: "STUDSELF CLINCH 8-32 X 3/8 SST CONCEALED HD" },
        ],
      });
    }

    try {
      const base64Image = req.file.buffer.toString("base64");
      const mimeType    = req.file.mimetype || "image/png";

      const systemPrompt = `You are a senior semiconductor equipment manufacturing engineer at HCS Engineering (Singapore). You are an expert at reading BOM tables from AMAT engineering drawings with high precision.`;

      const userPrompt = `This is a cropped image of the BOM (Bill of Materials) table from an AMAT engineering drawing.
The table has columns: ITEM | QTY | PART NO. | DESCRIPTION | TCENG NO.
Extract every data row with extreme care and return ONLY valid JSON in this exact format:
{
  "rows": [
    { "itemNo": 1, "qty": 1, "description": "full description text" },
    { "itemNo": 2, "qty": 3, "description": "full description text" }
  ]
}
Rules:
- itemNo = the ITEM column integer.
- qty = the QTY column integer.
- description = the DESCRIPTION column text exactly as written.
- Do NOT include Part No. or TCENG No. in the description.
- Skip any header rows (ITEM, QTY, PART NO., DESCRIPTION, TCENG NO.).
- Return ONLY the JSON object, no markdown, no explanation.`;

      const parsed = await geminiExtract(apiKey, modelId, systemPrompt, userPrompt, base64Image, mimeType);
      res.json(parsed);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "BOM extraction failed" });
    }
  });

  // ─── Weld Extraction: reads a weld symbol crop, returns multiple rows ──────────────────────
  app.post("/api/extract-weld", upload.single("crop"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No crop image provided" });
    const apiKey  = req.headers["x-gemini-key"]   as string || process.env.GEMINI_API_KEY;
    const modelId = req.headers["x-gemini-model"] as string || "gemini-1.5-flash";

    if (!apiKey) {
      // Mock mode — return sample 7-row fillet weld output (2X, size+distance+pitch)
      return res.json({
        mock: true,
        rows: [
          { rowType: "NOTE",      description: "2X WELDING",             gdtType: "", nominalValue: "In Compliance" },
          { rowType: "DIMENSION", description: "2X WELD SIZE (MIN)",     gdtType: "", nominalValue: "0.19" },
          { rowType: "DIMENSION", description: "2X WELD SIZE (MAX)",     gdtType: "", nominalValue: "0.19" },
          { rowType: "DIMENSION", description: "2X WELD DISTANCE (MIN)", gdtType: "", nominalValue: "0.75" },
          { rowType: "DIMENSION", description: "2X WELD DISTANCE (MAX)", gdtType: "", nominalValue: "0.75" },
          { rowType: "DIMENSION", description: "2X WELD PITCH (MIN)",    gdtType: "", nominalValue: "3.00" },
          { rowType: "DIMENSION", description: "2X WELD PITCH (MAX)",    gdtType: "", nominalValue: "3.00" },
        ],
      });
    }

    const WELD_SYSTEM_PROMPT = `You are a weld symbol extraction expert for HCS Engineering (Singapore), reading AMAT (Applied Materials) engineering drawings.

Given a cropped image containing one or more weld symbols, extract ALL weld information and return ONLY valid JSON.

== SYMBOL RECOGNITION GUIDE ==
- Right-angle triangle (arrow side below / other side above line) = Fillet Weld
- Asymmetrical V (one straight + one slanted line) = Bevel Weld
- Symmetrical V (two equally slanted lines) = V-Groove Weld
- C-like curve = Convex Fillet Weld
- || double parallel lines = Square Weld
- Values on BOTH sides of line = Both-Sides Weld (treat each side independently)
- Small circle at junction = Weld All Around
- Curved arc above line = Back Weld
- Small square/rectangle on line = Plug/Slot Weld
- G letter above/below symbol = Grind Flush modifier -> adds " AND GRIND FLUSH" to NOTE Col D
- Small horizontal line below weld symbol = Weld Flush modifier:
  * Single weld (no multiplier): IGNORED — Col D unchanged
  * Multiple welds (has multiplier): NOTE Col D changes from "{N}X WELDING" to "{N}X WELDING FLUSH"
  * Example: 2X + horizontal line + size .18 -> NOTE Col D = "2X WELDING FLUSH"
  * Does NOT add "AND GRIND FLUSH" — only G letter = Grind Flush
- Triangle with number inside = IGNORE (drawing notes reference, not a weld symbol)
- Circle with number inside = BOM Item Number (1 NOTE row: Col D = "ITEM {n}, {full text as-is}")
  * CRITICAL: Col D MUST start with "ITEM {n}, " — NEVER drop the item number prefix
  * Example: circle \(17\) with text "4X FAR SIDE" → Col D: "ITEM 17, 4X FAR SIDE"
  * Example: circle \(19\) with text "2X REF FAR SIDE" → Col D: "ITEM 19, 2X REF FAR SIDE"
  * Example: circle \(6\) with text "SEE DETAIL 6 SH 4" → Col D: "ITEM 6, SEE DETAIL 6 SHEET 4"
  * REF annotations, FAR SIDE, multipliers — include everything verbatim after the item number
  * Tool: Draw Balloon manually — do NOT use Extract Weld for these

== MULTIPLIER NOTATION ==
- N1 = first multiplier (e.g. 2X)
- N2 = second multiplier (e.g. 3 SIDES)
- N3 = N1 x N2 = total count used in DIMENSION row prefix
- Single multiplier only: N1 = N3 (e.g. 4X -> N3=4)
- "3 SIDES" alone with no "2X" prefix: N3=3

== X-Y FORMAT ==
- X-Y in weld symbols = WELD DISTANCE - WELD PITCH. NEVER a min-max range.
- e.g. 1.5-4 -> DISTANCE=1.5, PITCH=4

== COL D FORMAT ==
- NOTE rows: preserve drawing wording exactly. Col D = exactly what the drawing says.
  Examples: "2X WELDING", "WELDING X 3 SIDES", "2X WELDING AND GRIND FLUSH", "3X WELDING AND GRIND FLUSH", "4X BACKWELD", "2X BACKWELD"
  Use the actual weld type name from the drawing (BACKWELD, WELDING, etc.) — never substitute one for another.
- DIMENSION rows — SINGLE weld (no multiplier on drawing):
  Exact values: "WELD SIZE", "WELD DISTANCE", "WELD PITCH"
  NO prefix of any kind. NO "1X". NO (MIN). NO (MAX). Just the plain name.
- DIMENSION rows — MULTIPLE welds (has NX or N SIDES on drawing):
  Format: "{N3}X WELD SIZE (MIN)", "{N3}X WELD SIZE (MAX)", "{N3}X WELD DISTANCE (MIN)", etc.
  Every DIMENSION type always has TWO rows: one (MIN) and one (MAX). Both have the same nominalValue.
- CRITICAL: "1X" is NEVER valid. If there is no multiplier on the drawing, there is NO prefix at all.
- No PJP in Col D

== ROW COUNT RULES ==
For each weld side independently:

SINGLE WELD (no multiplier — no NX, no N SIDES):
- No (MIN)/(MAX) for single welds. One row per measurement type.
- Size only -> 1x WELD SIZE = 1 row (no NOTE)
- Size + distance + pitch -> WELD SIZE + WELD DISTANCE + WELD PITCH = 3 rows (no NOTE)
- Size + distance (no pitch) -> WELD SIZE + WELD DISTANCE = 2 rows (no NOTE)
- Parentheses on size, with distance+pitch -> NOTE "WELDING" + WELD DISTANCE + WELD PITCH = 3 rows
- Parentheses on size only -> 1 NOTE "WELDING" row only

MULTIPLE WELDS (has any multiplier — NX or N SIDES):
- (MIN) and (MAX) rows required for every DIMENSION type. Two rows per measurement type, same value.
- CRITICAL: Only create DIMENSION rows if numeric size/distance/pitch values appear DIRECTLY ON the weld symbol itself (attached to the symbol lines or reference line). IGNORE all other numbers in the image — title block numbers, part numbers, weight values, drawing border numbers are NOT weld values.
- Text labels like "BACKWELD", "FAR SIDE", "REF", "TYP" are NOT numeric values — do NOT generate DIMENSION rows for them.
- No numeric values on the symbol -> 1 NOTE row only. Col D = exact weld description from drawing (e.g. "4X BACKWELD"). Do NOT invent DISTANCE, SIZE, or PITCH rows from numbers seen elsewhere in the image.
- EXAMPLE: "4X BACKWELD" symbol with no numbers attached -> 1 NOTE row ONLY: Col D = "4X BACKWELD", nominalValue = "In Compliance". The value 1.750 seen in a title block or elsewhere in the image is NOT a weld dimension.
- Size only -> NOTE + SIZE(MIN) + SIZE(MAX) = 3 rows
- Size + distance -> NOTE + SIZE(MIN) + SIZE(MAX) + DISTANCE(MIN) + DISTANCE(MAX) = 5 rows
- Size + distance + pitch -> NOTE + SIZE(MIN) + SIZE(MAX) + DISTANCE(MIN) + DISTANCE(MAX) + PITCH(MIN) + PITCH(MAX) = 7 rows
- Parentheses on size, with distance+pitch -> NOTE + DISTANCE(MIN) + DISTANCE(MAX) + PITCH(MIN) + PITCH(MAX) = 5 rows
- Parentheses on size only -> 1 NOTE "{N}X WELDING" row only

BOTH-SIDES WELD:
- EACH SIDE gets its OWN NOTE row. Never share a NOTE row between sides.
- Apply the above rules to each side independently, then concatenate all rows.

== OUTPUT FORMAT ==
Return ONLY valid JSON. Examples below — choose the correct format based on whether multiplier is present:

EXAMPLE A — SINGLE WELD, size only (e.g. fillet .18, NO multiplier):
{
  "rawReading": "fillet weld, size 0.18, no multiplier",
  "rows": [
    { "rowType": "DIMENSION", "description": "WELD SIZE", "gdtType": "", "nominalValue": "0.18" }
  ],
  "confidence": "high"
}

EXAMPLE B — SINGLE WELD, size + distance + pitch (e.g. fillet .19 / .50-1.50, NO multiplier):
{
  "rawReading": "fillet weld, size 0.19, distance 0.50, pitch 1.50, no multiplier",
  "rows": [
    { "rowType": "DIMENSION", "description": "WELD SIZE",     "gdtType": "", "nominalValue": "0.19" },
    { "rowType": "DIMENSION", "description": "WELD DISTANCE", "gdtType": "", "nominalValue": "0.50" },
    { "rowType": "DIMENSION", "description": "WELD PITCH",    "gdtType": "", "nominalValue": "1.50" }
  ],
  "confidence": "high"
}

EXAMPLE C — MULTIPLE WELDS, size only, WITH Weld Flush (e.g. 2X fillet .18 + horizontal line below):
{
  "rawReading": "2X fillet weld, size 0.18, weld flush modifier",
  "rows": [
    { "rowType": "NOTE",      "description": "2X WELDING FLUSH",    "gdtType": "", "nominalValue": "In Compliance" },
    { "rowType": "DIMENSION", "description": "2X WELD SIZE (MIN)", "gdtType": "", "nominalValue": "0.18" },
    { "rowType": "DIMENSION", "description": "2X WELD SIZE (MAX)", "gdtType": "", "nominalValue": "0.18" }
  ],
  "confidence": "high"
}

EXAMPLE D — MULTIPLE WELDS, size + distance + pitch (e.g. 2X fillet .19 / .75-3.00):
{
  "rawReading": "2X fillet weld, size 0.19, distance 0.75, pitch 3.00",
  "rows": [
    { "rowType": "NOTE",      "description": "2X WELDING",             "gdtType": "", "nominalValue": "In Compliance" },
    { "rowType": "DIMENSION", "description": "2X WELD SIZE (MIN)",     "gdtType": "", "nominalValue": "0.19" },
    { "rowType": "DIMENSION", "description": "2X WELD SIZE (MAX)",     "gdtType": "", "nominalValue": "0.19" },
    { "rowType": "DIMENSION", "description": "2X WELD DISTANCE (MIN)", "gdtType": "", "nominalValue": "0.75" },
    { "rowType": "DIMENSION", "description": "2X WELD DISTANCE (MAX)", "gdtType": "", "nominalValue": "0.75" },
    { "rowType": "DIMENSION", "description": "2X WELD PITCH (MIN)",    "gdtType": "", "nominalValue": "3.00" },
    { "rowType": "DIMENSION", "description": "2X WELD PITCH (MAX)",    "gdtType": "", "nominalValue": "3.00" }
  ],
  "confidence": "high"
}

EXAMPLE E — MULTIPLE WELDS, NO numeric values (e.g. 4X BACKWELD, no size/distance/pitch numbers on symbol):
{
  "rawReading": "4X backweld, no numeric values on symbol",
  "rows": [
    { "rowType": "NOTE", "description": "4X BACKWELD", "gdtType": "", "nominalValue": "In Compliance" }
  ],
  "confidence": "high"
}

Rules:
- rowType: "NOTE" or "DIMENSION" only
- gdtType: always "" for all weld rows
- nominalValue: numeric string for DIMENSION rows (e.g. "0.19"); "In Compliance" for NOTE rows
- Return ONLY the JSON object. No markdown fences. No explanation text.`;

    try {
      const base64Image = req.file.buffer.toString("base64");
      const mimeType    = req.file.mimetype || "image/png";
      const userPrompt  = `You are a senior semiconductor equipment manufacturing engineer and certified welding inspector at HCS Engineering (Singapore), specialising in AMAT engineering drawings. Examine this weld symbol crop with extreme precision — every detail matters for FAI compliance. Extract all weld symbol rows accurately.`;

      const parsed = await geminiExtract(apiKey, modelId, WELD_SYSTEM_PROMPT, userPrompt, base64Image, mimeType);
      res.json(parsed);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Weld extraction failed" });
    }
  });

  // ─── Export to Excel ─────────────────────────────────────────────────────────
  app.get("/api/sessions/:id/export-excel", async (req, res) => {
    const session = storage.getSession(Number(req.params.id));
    if (!session) return res.status(404).json({ error: "Session not found" });

    // Parse session settings
    let settings: {
      firPqr?: string;
      tolerances?: { x?: string; xx?: string; xxx?: string; xxxx?: string };
      toolCalMap?: Record<string, string>;
    } = {};
    try { settings = JSON.parse(session.settingsJson || "{}"); } catch {}

    const sessionFirPqr = settings.firPqr || "PQR";
    // toolCalMap: keys are exact tool strings e.g. "CMM - 8535-6-12609-UC" -> "03/01/2027"
    const toolCalMap: Record<string, string> = settings.toolCalMap || {};

    // Helper: look up cal date for a tool string (exact match first, then contains)
    function getCalDate(toolStr: string): string {
      if (!toolStr || toolStr.toLowerCase().includes("visual")) return "";
      // Exact match
      if (toolCalMap[toolStr]) return toolCalMap[toolStr];
      // Fallback: find any key that contains the tool string
      const found = Object.entries(toolCalMap).find(([k]) =>
        k.toLowerCase().includes(toolStr.toLowerCase()) ||
        toolStr.toLowerCase().includes(k.toLowerCase())
      );
      return found ? found[1] : "";
    }

    const balloons = storage.getBalloonsBySession(Number(req.params.id));
    // Sort by balloon number ascending
    const sorted = [...balloons].sort((a, b) => {
      const na = parseFloat(a.balloonNumber) || 0;
      const nb = parseFloat(b.balloonNumber) || 0;
      return na - nb;
    });

    // Part number = PDF filename without extension
    const partNumber = session.pdfFileName.replace(/\.pdf$/i, "");
    // Export filename = same
    const exportFileName = partNumber + ".xlsx";

    // Find the template file
    const templatePath = path.resolve(process.cwd(), "template", "FAI_TEMPLATE.xlsx");
    if (!fs.existsSync(templatePath)) {
      return res.status(500).json({ error: "FAI template not found at server/template/FAI_TEMPLATE.xlsx" });
    }

    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(templatePath);

      const ws = wb.getWorksheet("Notes & Dimensions");
      if (!ws) return res.status(500).json({ error: "'Notes & Dimensions' sheet not found in template" });

      const DATA_START = 6;  // first data row
      const lastRow = ws.rowCount;

      // Overwrite existing rows (preserves data validations on those rows)
      sorted.forEach((b, i) => {
        const rowNum = DATA_START + i;
        const row = ws.getRow(rowNum);

        row.getCell(1).value  = partNumber;                        // Col A: Part Number
        row.getCell(2).value  = b.rowType || "DIMENSION";          // Col B: Row Type
        row.getCell(3).value  = b.balloonNumber;                   // Col C: Feature Number
        row.getCell(4).value  = b.description || "";              // Col D: Description
        row.getCell(5).value  = "";                                // Col E: Standard Notes (user fills)
        row.getCell(6).value  = b.gdtType || "";                  // Col F: GD&T Type
        row.getCell(7).value  = b.nominalValue || "";             // Col G: Nominal Value
        row.getCell(8).value  = b.lowerTolerance || "";                    // Col H: Lower Tolerance
        row.getCell(9).value  = b.upperTolerance || "";                     // Col I: Upper Tolerance
        row.getCell(10).value = b.actualValue || "";                         // Col J: Actual Value (blank for inspector)
        row.getCell(11).value = b.rowType === "NOTE" ? "" : (b.materialCondition || "NONE"); // Col K
        row.getCell(12).value = b.tool || "";                               // Col L: Tool
        row.getCell(13).value = getCalDate(b.tool || "");                   // Col M: Cal Date from session settings
        row.getCell(14).value = sessionFirPqr;                               // Col N: FIR/PQR from session settings

        // Style: Arial 8pt, yellow fill, borders
        for (let c = 1; c <= 14; c++) {
          const cell = row.getCell(c);
          cell.font      = { name: "Arial", size: 8 };
          cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFACD" } };
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border    = {
            top:    { style: "thin", color: { argb: "FF000000" } },
            bottom: { style: "thin", color: { argb: "FF000000" } },
            left:   { style: "thin", color: { argb: "FF000000" } },
            right:  { style: "thin", color: { argb: "FF000000" } },
          };
        }
        row.height = 30;
        row.commit();
      });

      // Clear leftover rows beyond balloon count (blank them out, keep formatting)
      for (let r = DATA_START + sorted.length; r <= lastRow; r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= 14; c++) row.getCell(c).value = null;
        row.commit();
      }

      // Ensure Col E dropdown exists (_Lists!$C$1:$C$33 = Standard Notes)
      // Always set — ExcelJS merges/overwrites safely
      (ws as any).dataValidations.add("E6:E505", {
        type: "list",
        allowBlank: true,
        formulae: ["_Lists!$C$1:$C$33"],
      });

      // Stream the file back
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${exportFileName}"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Export failed" });
    }
  });

  return httpServer;
}
