# HCS-AMAT Weld Symbol Teaching Log

> Purpose: Reference log built during teaching sessions. Used to guide AI extraction of weld symbols from AMAT engineering drawings into the FAI Excel template.
> Last updated: 2026-05-24

---

## Weld Symbol Recognition Guide

A quick reference of all weld symbols encountered on AMAT drawings.

| Symbol | Name | Notes |
|---|---|---|
| Right-angle **triangle** (▷) below line | Fillet Weld (arrow side) | Most common |
| Right-angle **triangle** (▷) above line | Fillet Weld (other side) | Same table rules |
| **V shape** / diagonal below line | Bevel Weld (arrow side) | Asymmetrical — one straight vertical + one slanted line (`|/`) |
| **V shape** / diagonal above line | Bevel Weld (other side) | Asymmetrical — one straight vertical + one slanted line (`|/`) |
| Symmetrical **V** (two slanted lines `\/`) below line | V-Groove Weld (arrow side) | Same table rules as fillet/bevel weld |
| Symmetrical **V** (two slanted lines `\/`) above line | V-Groove Weld (other side) | Same table rules as fillet/bevel weld |
| `C`-like / bracket curve | Convex Fillet Weld | Same table rules as fillet weld |
| `\|\|` double parallel lines | Square Weld | Same table rules as fillet weld |
| Values on BOTH sides of line | Both-Sides Weld | Each side = independent set of rows |
| Small circle at junction | Weld All Around | Combined with fillet or bevel weld symbol |
| Curved arc **above** reference line | Back Weld / Backing Weld | No numbers = 1 NOTE row only |
| One straight line + one curved line | Flare Bevel Weld | Position varies per customer; no numbers = 1 NOTE row only |
| Small square / rectangle on line | Plug / Slot Weld | G above/below = grind flush, changes Col D |
| G letter above/below weld symbol | Grind Flush modifier | Adds `AND GRIND FLUSH` to Col D |
| Small horizontal line below **weld** symbol | Weld Flush modifier | **Single weld:** ignored — does NOT change Col D. **Multiple welds:** changes NOTE Col D from `{N}X WELDING` to `{N}X WELDING FLUSH`. Only `G` letter = Grind Flush |
| Triangle with number inside | Drawing Notes Reference | NOT a weld symbol — ignore |

---

## Balloon Numbering Rules

- **1 row = 1 balloon** — every row gets its own unique balloon number
- **Continue from last** — balloon numbers continue from whatever the last generated balloon number was (do not restart from 1)
- **Sequential** — each new row increments by 1 (e.g. if last balloon was 5, next rows get 6, 7, 8...)

**Example:** `2X, 3 SIDES .10 V` produces 3 rows → 3 balloons (e.g. 6, 7, 8 if last was 5)

---

## ⚠️ Common Mistake to Avoid

**`X-Y` format in weld symbols = DISTANCE - PITCH, NOT min-max range.**
- e.g. `1.5-4` → WELD DISTANCE = 1.5, WELD PITCH = 4
- MIN and MAX for each are always the same value (e.g. DISTANCE MIN = 1.5, DISTANCE MAX = 1.5)
- Never interpret the `-` separator as a min-max range

---

## General Rules

- **Col B** for all weld rows = `DIMENSION`
- **Col K** for DIMENSION rows = `NONE`
- **Col K** for NOTE rows = blank (empty)
- **Col L** for all weld rows = `Caliper - 0-300mm` (unless overridden, e.g. parentheses case)
- No PJP included in Col D
- Triangles with numbers inside = drawing notes references, NOT weld symbols

---

## Row Count Rules

| Condition | Rows | WELD SIZE | WELD DISTANCE | WELD PITCH |
|---|---|---|---|---|
| Size only (no distance/pitch) | 1 | DIMENSION (1 row) | — | — |
| Single weld, no parentheses | 3 | DIMENSION (1 row) | DIMENSION (1 row) | DIMENSION (1 row) |
| Single weld, parentheses on size | 3 | NOTE: WELDING (1 row) | DIMENSION (1 row) | DIMENSION (1 row) |
| Multiple welds, no parentheses | 7 | NOTE: {N}X WELDING (1 row) + DIMENSION MIN+MAX (2 rows) | DIMENSION MIN+MAX (2 rows) | DIMENSION MIN+MAX (2 rows) |
| Multiple welds, no parentheses, size only | 3 | NOTE: {N}X WELDING (1 row) + DIMENSION MIN+MAX (2 rows) | — | — |
| Multiple welds, no parentheses, size + distance only (no pitch) | 5 | NOTE: {N}X WELDING (1 row) + DIMENSION MIN+MAX (2 rows) | DIMENSION MIN+MAX (2 rows) | — |
| Multiple welds, parentheses on size, with distance+pitch | 5 | NOTE: {N}X WELDING (1 row) | DIMENSION MIN+MAX (2 rows) | DIMENSION MIN+MAX (2 rows) |
| Multiple welds, parentheses on size, no distance/pitch | 1 | NOTE: {N}X WELDING (1 row) | — | — |

---

## Fillet Weld (Right-Angle Triangle Symbol)

**Symbol:** Right-angle triangle (▷) on the weld reference line
**Arrow side** = triangle below the line
**Other side** = triangle above the line

### Format on drawing:
```
[multiplier]  [size]  ▷  [distance]-[pitch]
```

### Single weld (no multiplier) — 3 rows:

| Col D | Col G | Col K | Col L |
|---|---|---|---|
| WELD SIZE | {size} | NONE | Caliper - 0-300mm |
| WELD DISTANCE | {distance} | NONE | Caliper - 0-300mm |
| WELD PITCH | {pitch} | NONE | Caliper - 0-300mm |

**Example:** `.19 V .75-4.00` → WELD SIZE=0.19, WELD DISTANCE=0.75, WELD PITCH=4.00

---

### Multiple welds (3 SIDES / 3X / any multiplier) — 7 rows (size+distance+pitch) or 3 rows (size only):

**With size + distance + pitch — 7 rows:**

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | {N}X WELDING | In Compliance | | Visual - Visual inspection |
| DIMENSION | {N}X WELD SIZE (MIN) | {size} | NONE | Caliper - 0-300mm |
| DIMENSION | {N}X WELD SIZE (MAX) | {size} | NONE | Caliper - 0-300mm |
| DIMENSION | {N}X WELD DISTANCE (MIN) | {distance} | NONE | Caliper - 0-300mm |
| DIMENSION | {N}X WELD DISTANCE (MAX) | {distance} | NONE | Caliper - 0-300mm |
| DIMENSION | {N}X WELD PITCH (MIN) | {pitch} | NONE | Caliper - 0-300mm |
| DIMENSION | {N}X WELD PITCH (MAX) | {pitch} | NONE | Caliper - 0-300mm |

**Size only — 3 rows:**

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | {N}X WELDING | In Compliance | | Visual - Visual inspection |
| DIMENSION | {N}X WELD SIZE (MIN) | {size} | NONE | Caliper - 0-300mm |
| DIMENSION | {N}X WELD SIZE (MAX) | {size} | NONE | Caliper - 0-300mm |

**How to calculate {N}:** Multiply all multipliers together. e.g. `2X, 3 SIDES` = 2×3 = 6 → total `6X`

**NOTE row Col D format — preserve drawing wording exactly:**
- `3 SIDES` → Col D: `WELDING X 3 SIDES`
- `3X` → Col D: `3X WELDING`
- `2X, 3 SIDES` → Col D: `2X WELDING, 3 SIDES`

**DIMENSION rows Col D format — always use calculated total {N}X prefix:**
- `3 SIDES` → `3X WELD SIZE (MIN)`, `3X WELD SIZE (MAX)`, etc.
- `2X, 3 SIDES` → `6X WELD SIZE (MIN)`, `6X WELD SIZE (MAX)`, etc.

**Example:** `3 SIDES .10 V 1.5-3.0` → NOTE: `WELDING X 3 SIDES`, DIMENSION rows: `3X WELD SIZE (MIN/MAX)`, `3X WELD DISTANCE (MIN/MAX)`, `3X WELD PITCH (MIN/MAX)`
**Example:** `2X, 3 SIDES .10 V` (size only) → NOTE: `2X WELDING, 3 SIDES`, DIMENSION rows: `6X WELD SIZE (MIN/MAX)`

---

### Parentheses on weld size e.g. `(.10)` — single weld = 3 rows, multiple welds = 5 rows:

When the size value is in parentheses, the WELD SIZE rows are **replaced** by a single NOTE row.
Row count for distance/pitch still follows the same single vs multiple weld rule.

**Single weld (no multiplier) — 3 rows:**

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | WELDING | In Compliance | | Visual - Visual inspection |
| DIMENSION | WELD DISTANCE | {distance} | NONE | Caliper - 0-300mm |
| DIMENSION | WELD PITCH | {pitch} | NONE | Caliper - 0-300mm |

**Example:** `(.10) V 1.5-3.0` (no multiplier) → 1 NOTE + 2 DIMENSION rows

**Multiple welds, parentheses, no distance/pitch — 1 row:**

When parentheses on size AND no distance/pitch, produce **1 NOTE row only**. {N}X prefix still applied.

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | {N}X WELDING | In Compliance | | Visual - Visual inspection |

**Example:** `(.10) || 2X` → NOTE: `2X WELDING` (1 row only)

**Multiple welds, parentheses, with distance/pitch — 5 rows:**

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | {N}X WELDING | In Compliance | | Visual - Visual inspection |
| DIMENSION | {N}X WELD DISTANCE (MIN) | {distance} | NONE | Caliper - 0-300mm |
| DIMENSION | {N}X WELD DISTANCE (MAX) | {distance} | NONE | Caliper - 0-300mm |
| DIMENSION | {N}X WELD PITCH (MIN) | {pitch} | NONE | Caliper - 0-300mm |
| DIMENSION | {N}X WELD PITCH (MAX) | {pitch} | NONE | Caliper - 0-300mm |

**Example:** `3 SIDES (.10) V 1.5-3.0` → NOTE: `WELDING X 3 SIDES`, `3X WELD DISTANCE (MIN/MAX)`, `3X WELD PITCH (MIN/MAX)`
**Note:** If there is a `G` in the image alongside the parentheses — additional options apply (TBD, to be taught later).

---

### Multiple welds, size + distance only (no pitch) — 5 rows:

When multiplier is present but **no pitch value** is shown, skip the WELD PITCH rows.

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | {N}X WELDING | In Compliance | | Visual - Visual inspection |
| DIMENSION | {N}X WELD SIZE (MIN) | {size} | NONE | Caliper - 0-300mm |
| DIMENSION | {N}X WELD SIZE (MAX) | {size} | NONE | Caliper - 0-300mm |
| DIMENSION | {N}X WELD DISTANCE (MIN) | {distance} | NONE | Caliper - 0-300mm |
| DIMENSION | {N}X WELD DISTANCE (MAX) | {distance} | NONE | Caliper - 0-300mm |

**Example:** `.19 V .25 4X` → N=4, 4X WELDING (NOTE), 4X WELD SIZE (MIN/MAX), 4X WELD DISTANCE (MIN/MAX)
**Note:** The `4X` multiplier can appear on the right side of the arrow symbol, not just on the left.

---

## Convex Fillet Weld (C-like / Bracket Contour Symbol)

**Symbol:** A curved `C`-like or bracket shape on the weld reference line (convex contour indicator)
**Recognition:** Must be identified as a weld type — do NOT ignore it
**Table structure:** Identical to regular fillet weld — all the same row count rules apply

- Single / multiple weld rules → same
- Parentheses on size rules → same
- Pitch / no pitch rules → same
- {N}X prefix rules → same
- Col B, Col G, Col K, Col L → same

**Example:** `.19 C .25` (single weld, no pitch) → 2 rows (WELD SIZE + WELD DISTANCE)
**Example:** `.19 C .25 4X` (multiple welds, no pitch) → 5 rows (NOTE + MIN/MAX for size + MIN/MAX for distance)
**Example:** `.19 C .75-3.00 2X AVOID PERFORATED AREA` (multiple welds, size+distance+pitch, instruction text ignored) → 7 rows:
- NOTE: `2X WELDING`
- DIMENSION: `2X WELD SIZE (MIN/MAX)` = 0.19
- DIMENSION: `2X WELD DISTANCE (MIN/MAX)` = 0.75
- DIMENSION: `2X WELD PITCH (MIN/MAX)` = 3.00
- `AVOID PERFORATED AREA` text → ignored entirely

---

## Both-Sides Weld

**Symbol:** Values appear on BOTH sides of the reference line (top and bottom)
**Rule:** Each side produces its own **completely independent** set of rows — do NOT combine, do NOT share a NOTE row
**Col D labels:** No side differentiation needed — both use same labels (WELD SIZE, WELD DISTANCE, etc.)
**KEY RULE (confirmed image-86 & image-88):** Each side always gets its OWN NOTE row. Even if both sides have identical values, the NOTE row is never shared.

**Example:** `2X .25` both sides, size only (image-88) → **6 rows** (3 per side):

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | 2X WELDING | In Compliance | *(blank)* | Visual - Visual inspection |
| DIMENSION | 2X WELD SIZE (MIN) | .25 | NONE | Caliper - 0-300mm |
| DIMENSION | 2X WELD SIZE (MAX) | .25 | NONE | Caliper - 0-300mm |
| NOTE | 2X WELDING | In Compliance | *(blank)* | Visual - Visual inspection |
| DIMENSION | 2X WELD SIZE (MIN) | .25 | NONE | Caliper - 0-300mm |
| DIMENSION | 2X WELD SIZE (MAX) | .25 | NONE | Caliper - 0-300mm |

**Note:** Each side follows all the same single/multiple weld rules independently.

---

## Square Weld (|| symbol)

**Symbol:** Two parallel vertical lines `||` on the weld reference line
**Recognition:** Must be identified as a weld type
**Table structure:** Identical to regular fillet weld — all the same row count rules apply
**`USE RELIEFS` annotation:** Ignore — does not affect the table

**Example:** `.12 || .75 USE RELIEFS, 5X` (multiple welds, size + distance, no pitch) → **5 rows:**

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | 5X WELDING | In Compliance | | Visual - Visual inspection |
| DIMENSION | 5X WELD SIZE (MIN) | 0.12 | NONE | Caliper - 0-300mm |
| DIMENSION | 5X WELD SIZE (MAX) | 0.12 | NONE | Caliper - 0-300mm |
| DIMENSION | 5X WELD DISTANCE (MIN) | 0.75 | NONE | Caliper - 0-300mm |
| DIMENSION | 5X WELD DISTANCE (MAX) | 0.75 | NONE | Caliper - 0-300mm |

---

## Weld All Around (Circle at Junction)

**Symbol:** Small circle at the junction of the reference line and arrow line
**Recognition:** Must be identified as a weld type — the circle indicates welding goes all the way around the joint
**Often combined with:** Fillet weld (triangle) or Bevel weld (V shape) symbol on the reference line
**Table structure:** Follows all the same fillet weld row count rules

**Special case — no size/distance/pitch numbers, only a multiplier:**
Produce **1 NOTE row only**
- Col D: `{N}X WELDING` (e.g. `2X WELDING`)
- Any instruction text on drawing (e.g. `DO NOT FILL TABS, DO NOT WELD AND GRIND TOP SURFACES`) — **ignore entirely**

**Example:** `2X` + circle + V + instruction text (no numbers):

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | 2X WELDING | In Compliance | | Visual - Visual inspection |

---

## Back Weld / Backing Weld (Curved Arc Above Reference Line)

**Symbol:** Curved arc / semicircle above the reference line
**Recognition:** Must be identified as a weld type
**`BACKWELD` text on drawing:** Confirms it is a back weld — ignore the text for Col D
**Rule:** No size/distance/pitch numbers = **1 NOTE row only**
- Col D: `{N}X WELDING`
- `BACKWELD` text ignored

**Example:** `4X BACKWELD` with curved arc symbol (no numbers):

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | 4X WELDING | In Compliance | | Visual - Visual inspection |

---

## Plug / Slot Weld (Square Symbol)

**Symbol:** Small square or rectangle on the weld reference line
**Recognition:** Must be identified as a weld type
**Without G modifier:** No grind flush needed — Col D = `{N}X WELDING` only
**`G` modifier:** Appears above or below the reference line — means **grind flush**. Changes Col D wording to include `AND GRIND FLUSH`
**`BOTTOM` / `TOP` text:** Indicates which side the weld applies to — include in Col D
**Rule:** No size/distance/pitch numbers = 1 NOTE row only

**Col D format WITHOUT G modifier:**
`{N}X WELDING`

**Col D format WITH G modifier:**
`{N}X WELDING AND GRIND FLUSH, {SIDE}`

**Example:** Square symbol + `G` above line + `2X BOTTOM`:

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | 2X WELDING AND GRIND FLUSH, BOTTOM | In Compliance | | Visual - Visual inspection |

**Note:** The `G` modifier (grind flush) also applies to parentheses weld size cases — this will be taught later.

---

## G Modifier on Fillet Weld (Grind Flush)

**Symbol:** `G` appears above or below the fillet weld `V` symbol on the reference line
**Meaning:** Grind flush — changes Col D wording
**Rule:** No size/distance/pitch numbers = 1 NOTE row only

**Col D format:**
`WELDING AND GRIND FLUSH, {multiplier description}`

- `3 SIDES` → `WELDING AND GRIND FLUSH, 3 SIDES`
- `3X` → `WELDING AND GRIND FLUSH, 3X`
- `2X, 3 SIDES` → `WELDING AND GRIND FLUSH, 2X, 3 SIDES`

**Example:** `3 SIDES V G` (no numbers):

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | WELDING AND GRIND FLUSH, 3 SIDES | In Compliance | | Visual - Visual inspection |

---

## Bevel Weld (V Shape / Diagonal Symbol)

**Symbol:** V shape or single diagonal line on the weld reference line (asymmetrical — one side vertical, one side diagonal)
**Arrow side** = V below the line
**Other side** = V above the line
**Recognition:** Must be identified as a weld type — distinguish from Fillet (triangle) by shape
**Table structure:** Identical to Fillet Weld — all same row count rules apply
**Weld flush via horizontal line:** A small horizontal line below the weld symbol = Weld Flush.
- **Single weld:** Weld Flush ignored — Col D unchanged.
- **Multiple welds:** NOTE Col D changes from `{N}X WELDING` to `{N}X WELDING FLUSH`.
- Only `G` letter = Grind Flush (`AND GRIND FLUSH`).

**Example:** `image-65` — `2X .18` bevel weld with small horizontal line below = Weld Flush, multiple welds → Col D: `2X WELDING FLUSH`

---

## Flare Bevel Weld (One Straight Line + One Curved Line)

**Symbol:** Combination of one straight line and one curved line on the weld symbol
**Recognition:** Must be identified as a weld type
**Position:** Varies depending on where the customer wants the weld (above, below, or spanning reference line)
**Rule:** No size/distance/pitch numbers = 1 NOTE row only. Col D = `{N}X WELDING`

**Example:** Flare Bevel + `4X`, no numbers:

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | 4X WELDING | In Compliance | | Visual - Visual inspection |

---

## Weld All Around + Weld Flush, No Numbers (image-87)

**Image:** Bevel Weld (V shape) with small circle at junction (Weld All Around) + small horizontal line below symbol (Weld Flush — NOT Grind Flush, no G letter). Multiplier: `4X`. No size/distance/pitch numbers.

**Weld Type:** Bevel Weld, Weld All Around, Weld Flush

**Rule:** No numbers + multiplier only → 1 NOTE row. Weld Flush (horizontal line) with multiple welds changes Col D from `{N}X WELDING` to `{N}X WELDING FLUSH`.

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | 4X WELDING FLUSH | In Compliance | *(blank)* | Visual - Visual inspection |

**Total: 1 row**

---

## V-Groove Weld + G Modifier (Grind Flush), Multiple Welds, Size Only (image-90)

**Image:** V-Groove Weld (symmetrical V, two slanted lines) on both sides of reference line. `G` letter modifier = Grind Flush. Multiplier: `2X`. Size: `.25`. No distance, no pitch.

**Weld Type:** V-Groove Weld, Both Sides, Grind Flush

**Rule:** Multiple welds, size only, G letter modifier → 3 rows. Col D uses `WELDING AND GRIND FLUSH` format.

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | 2X WELDING AND GRIND FLUSH | In Compliance | *(blank)* | Visual - Visual inspection |
| DIMENSION | 2X WELD SIZE (MIN) | .25 | NONE | Caliper - 0-300mm |
| DIMENSION | 2X WELD SIZE (MAX) | .25 | NONE | Caliper - 0-300mm |

**Total: 3 rows**

---

## Both-Sides Fillet Weld — Multiple Welds, Size Only (image-88) ✅ CONFIRMED

**Image:** Fillet Weld (▷) on both sides of reference line. Multiplier: `2X`. Size only: `.25` on each side. No distance, no pitch.

**Weld Type:** Fillet Weld, Both Sides

**Rule:** Multiple welds, size only → **each side gets its OWN NOTE row** + 2 DIMENSION rows. Do NOT share a NOTE row between sides.

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | 2X WELDING | In Compliance | *(blank)* | Visual - Visual inspection |
| DIMENSION | 2X WELD SIZE (MIN) | .25 | NONE | Caliper - 0-300mm |
| DIMENSION | 2X WELD SIZE (MAX) | .25 | NONE | Caliper - 0-300mm |
| NOTE | 2X WELDING | In Compliance | *(blank)* | Visual - Visual inspection |
| DIMENSION | 2X WELD SIZE (MIN) | .25 | NONE | Caliper - 0-300mm |
| DIMENSION | 2X WELD SIZE (MAX) | .25 | NONE | Caliper - 0-300mm |

**Total: 6 rows** (3 rows per side × 2 sides)

---

## Both-Sides Fillet Weld — Multiple Welds, Size + Distance + Pitch (image-86) ✅ CONFIRMED

**Image:** `2X` with fillet weld triangle (▷) on both sides of reference line. Arrow side: `.25` size, `1-3` (distance-pitch). Other side: `.25` size, `1-3` (distance-pitch).

**Weld Type:** Fillet Weld, Both Sides

**X-Y format:** `1-3` = WELD DISTANCE `1`, WELD PITCH `3` — NOT a min-max range.

**Rule:** Multiple welds, size + distance + pitch → **each side gets its OWN NOTE row** + 6 DIMENSION rows. Do NOT share a NOTE row between sides.

**Arrow side (rows 1–7):**

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | 2X WELDING | In Compliance | *(blank)* | Visual - Visual inspection |
| DIMENSION | 2X WELD SIZE (MIN) | .25 | NONE | Caliper - 0-300mm |
| DIMENSION | 2X WELD SIZE (MAX) | .25 | NONE | Caliper - 0-300mm |
| DIMENSION | 2X WELD DISTANCE (MIN) | 1 | NONE | Caliper - 0-300mm |
| DIMENSION | 2X WELD DISTANCE (MAX) | 1 | NONE | Caliper - 0-300mm |
| DIMENSION | 2X WELD PITCH (MIN) | 3 | NONE | Caliper - 0-300mm |
| DIMENSION | 2X WELD PITCH (MAX) | 3 | NONE | Caliper - 0-300mm |

**Other side (rows 8–14):**

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | 2X WELDING | In Compliance | *(blank)* | Visual - Visual inspection |
| DIMENSION | 2X WELD SIZE (MIN) | .25 | NONE | Caliper - 0-300mm |
| DIMENSION | 2X WELD SIZE (MAX) | .25 | NONE | Caliper - 0-300mm |
| DIMENSION | 2X WELD DISTANCE (MIN) | 1 | NONE | Caliper - 0-300mm |
| DIMENSION | 2X WELD DISTANCE (MAX) | 1 | NONE | Caliper - 0-300mm |
| DIMENSION | 2X WELD PITCH (MIN) | 3 | NONE | Caliper - 0-300mm |
| DIMENSION | 2X WELD PITCH (MAX) | 3 | NONE | Caliper - 0-300mm |

**Total: 14 rows** (7 rows per side × 2 sides)

---

## Both-Sides Weld — Different Size Per Side (image-80) ⚠️ TO BE CONFIRMED

**Image:** `2X`, Both-Sides Weld. Other side (above line): Convex Fillet Weld (C curve), size `.22`. Arrow side (below line): Fillet Weld (▷ triangle), size `.25`. No distance, no pitch.

**Proposed interpretation:** Each side = different weld type + different size. Each side gets its own NOTE row + 2 DIMENSION rows → **6 rows total**.

**Proposed table (TO BE CONFIRMED):**

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | 2X WELDING | In Compliance | *(blank)* | Visual - Visual inspection |
| DIMENSION | 2X WELD SIZE (MIN) | .22 | NONE | Caliper - 0-300mm |
| DIMENSION | 2X WELD SIZE (MAX) | .22 | NONE | Caliper - 0-300mm |
| NOTE | 2X WELDING | In Compliance | *(blank)* | Visual - Visual inspection |
| DIMENSION | 2X WELD SIZE (MIN) | .25 | NONE | Caliper - 0-300mm |
| DIMENSION | 2X WELD SIZE (MAX) | .25 | NONE | Caliper - 0-300mm |

**Total: 6 rows** (3 rows per side × 2 sides)

⚠️ **TO BE CONFIRMED — user has not yet verified this interpretation. Do NOT use for programming until confirmed.**

---

## V-Groove Weld + Weld Flush, No Numbers (image-91 & image-92)

**image-91:** V-Groove Weld (both sides) + Weld All Around (circle) + Weld Flush (horizontal line below). Multiplier: `4X`. No numbers.
**image-92:** V-Groove Weld (both sides) + Weld Flush (horizontal line below). Multiplier: `16X`. No numbers.

**Rule:** Weld Flush (horizontal line) with multiple welds changes Col D from `{N}X WELDING` to `{N}X WELDING FLUSH`. No numbers → 1 NOTE row only.

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | {N}X WELDING FLUSH | In Compliance | *(blank)* | Visual - Visual inspection |

**image-91 example:** `4X WELDING FLUSH` (1 row)
**image-92 example:** `16X WELDING FLUSH` (1 row)

---

## Non-Welding Symbols

### Circle with Number Inside

**Symbol:** Circle with a number inside, pointing to text on the drawing (e.g. ⑥ SEE DETAIL 6 SH 4)
**Meaning:** Drawing detail reference — points to a specific detail/sheet on the drawing
**Rule:** Creates 1 NOTE row

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | ITEM {number}, {full text from drawing} | In Compliance | *(blank)* | Visual - Visual inspection |

**Example 1:** ⑥ `SEE DETAIL 6 SH 4` → Col D: `ITEM 6, SEE DETAIL 6 SHEET 4`

**Example 2:** ③ `2X SEE DETAIL 3 SH 4` → Col D: `ITEM 3, 2X SEE DETAIL 3 SHEET 4`

**Example 3 (image-147):** ⑲ `2X REF FAR SIDE` → Col D: `ITEM 19, 2X REF FAR SIDE`

**Rule:** Any multiplier (e.g. `2X`) shown on the drawing alongside the circle reference — include it in Col D as-is, as part of the description text.

**Rule:** `REF` (reference dimension) weld annotations next to a circle item number follow the same rule — include the full text as-is in Col D.

**Tool to use:** Draw Balloon (manual) — NOT Extract Weld. This is a non-welding symbol.

**Note:** Do NOT confuse with triangle with number inside — triangles = page 1 notes reference, different symbol entirely.
**Note:** Circle with number = **BOM Item Number** on the drawing.

---

## Weld Flush — Bevel Weld, Multiple Welds, Size Only (image-106) ✅ CONFIRMED

**Image:** Bevel weld symbol (asymmetrical V). Multiplier: `2X`. Size: `.18`. Small horizontal line below = Weld Flush. No `G` letter. No distance, no pitch.

**Weld Type:** Bevel Weld, Weld Flush, Multiple Welds

**Rule:** Multiple welds + Weld Flush → NOTE Col D = `{N}X WELDING FLUSH`. Size only → 3 rows.

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| NOTE | 2X WELDING FLUSH | In Compliance | *(blank)* | Visual - Visual inspection |
| DIMENSION | 2X WELD SIZE (MIN) | .18 | NONE | Caliper - 0-300mm |
| DIMENSION | 2X WELD SIZE (MAX) | .18 | NONE | Caliper - 0-300mm |

**Total: 3 rows**

---

## Weld Flush — Bevel Weld, Single Weld, Size Only (image-107) ✅ CONFIRMED

**Image:** Bevel weld symbol (asymmetrical V). No multiplier = single weld. Size: `.18`. Small horizontal line below = Weld Flush. No `G` letter. No distance, no pitch.

**Weld Type:** Bevel Weld, Weld Flush, Single Weld

**Rule:** Single weld + Weld Flush → Weld Flush ignored in Col D. Size only → 1 DIMENSION row, no NOTE row.

| Col B | Col D | Col G | Col K | Col L |
|---|---|---|---|---|
| DIMENSION | WELD SIZE | .18 | NONE | Caliper - 0-300mm |

**Total: 1 row**

---

## TO BE TAUGHT (Pending)

- Other weld symbol types (groove, spot, seam, etc.)
- `G` modifier alongside parentheses size (partial — more to be taught)
- Other multiplier notations
- Other-side / both-sides weld indicators
- Additional weld symbol variants from AMAT drawings
