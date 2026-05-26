import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertSessionSchema, insertBalloonSchema } from "@shared/schema";
import { z } from "zod";
import multer from "multer";
import OpenAI from "openai";

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

    const apiKey = req.headers["x-openai-key"] as string || process.env.OPENAI_API_KEY;

    // Mock mode if no API key
    if (!apiKey) {
      return res.json({
        rawReading: "MOCK MODE — no OpenAI API key configured. Enter your API key in Settings to enable real extraction.",
        rowType: "DIMENSION",
        description: "DISTANCE",
        gdtType: "",
        nominalValue: "0.000",
        confidence: "low",
        mock: true,
      });
    }

    try {
      const openai = new OpenAI({ apiKey });
      const base64Image = req.file.buffer.toString("base64");
      const mimeType = req.file.mimetype || "image/png";

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 500,
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: "high" },
              },
              { type: "text", text: "Extract the feature information from this engineering drawing crop." },
            ],
          },
        ],
      });

      const raw = response.choices[0].message.content || "{}";
      const cleaned = raw.replace(/```json\n?|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      res.json(parsed);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Extraction failed" });
    }
  });

  // ─── Bulk Extract: Notes block ─────────────────────────────────────────────
  // Returns array of { noteNum, noteText } parsed from the crop image.

  app.post("/api/extract-notes", upload.single("crop"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No crop image provided" });
    const apiKey = req.headers["x-openai-key"] as string || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      // Mock: return 3 fake notes
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
      const openai = new OpenAI({ apiKey });
      const base64Image = req.file.buffer.toString("base64");
      const mimeType = req.file.mimetype || "image/png";

      const prompt = `This is a cropped image of the NOTES section from an engineering drawing.
Your job is to extract EVERY numbered note. First, scan the entire image and count ALL the note numbers you can see (1, 2, 3, 4... up to the highest number). Then extract each one.

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

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: "high" } },
              { type: "text", text: prompt },
            ],
          },
        ],
      });

      const raw = response.choices[0].message.content || "{}";
      const cleaned = raw.replace(/```json\n?|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      res.json(parsed);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Notes extraction failed" });
    }
  });

  // ─── Bulk Extract: BOM table ─────────────────────────────────────────────────
  // Returns array of { itemNo, qty, description } parsed from the crop image.

  app.post("/api/extract-bom", upload.single("crop"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No crop image provided" });
    const apiKey = req.headers["x-openai-key"] as string || process.env.OPENAI_API_KEY;

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
      const openai = new OpenAI({ apiKey });
      const base64Image = req.file.buffer.toString("base64");
      const mimeType = req.file.mimetype || "image/png";

      const prompt = `This is a cropped image of the BOM (Bill of Materials) table from an engineering drawing.
The table has columns: ITEM | QTY | PART NO. | DESCRIPTION | TCENG NO.
Extract every data row and return ONLY valid JSON in this exact format:
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

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: "high" } },
              { type: "text", text: prompt },
            ],
          },
        ],
      });

      const raw = response.choices[0].message.content || "{}";
      const cleaned = raw.replace(/```json\n?|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      res.json(parsed);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "BOM extraction failed" });
    }
  });

  // ─── Weld Extraction: reads a weld symbol crop, returns multiple rows ──────────────────────
  app.post("/api/extract-weld", upload.single("crop"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No crop image provided" });
    const apiKey = req.headers["x-openai-key"] as string || process.env.OPENAI_API_KEY;

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
- Circle with number inside = BOM Item Number (1 NOTE row: "ITEM {n}, {text}")

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
- NOTE rows: preserve drawing wording exactly. Examples:
  "2X WELDING", "WELDING X 3 SIDES", "2X WELDING AND GRIND FLUSH", "3X WELDING AND GRIND FLUSH"
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
- CRITICAL: Only create DIMENSION rows if there are actual numeric size/distance/pitch values on the drawing symbol itself.
- Text labels like "BACKWELD", "FAR SIDE", "REF", "TYP" are NOT numeric values — do NOT generate DIMENSION rows for them.
- No numeric values at all -> 1 NOTE "{N}X WELDING" only (regardless of any text labels)
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

EXAMPLE C — MULTIPLE WELDS, size + distance + pitch (e.g. 2X fillet .19 / .75-3.00):
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

Rules:
- rowType: "NOTE" or "DIMENSION" only
- gdtType: always "" for all weld rows
- nominalValue: numeric string for DIMENSION rows (e.g. "0.19"); "In Compliance" for NOTE rows
- Return ONLY the JSON object. No markdown fences. No explanation text.`;

    try {
      const openai = new OpenAI({ apiKey });
      const base64Image = req.file.buffer.toString("base64");
      const mimeType = req.file.mimetype || "image/png";

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 2000,
        messages: [
          { role: "system", content: WELD_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: "high" } },
              { type: "text", text: "Extract all weld symbol rows from this engineering drawing crop." },
            ],
          },
        ],
      });

      const raw = response.choices[0].message.content || "{}";
      const cleaned = raw.replace(/```json\n?|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      res.json(parsed);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Weld extraction failed" });
    }
  });

  return httpServer;
}
