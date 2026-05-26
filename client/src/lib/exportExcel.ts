import ExcelJS from "exceljs";
import type { Balloon, Session } from "@shared/schema";

export async function exportToExcel(session: Session, balloons: Balloon[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Notes & Dimensions");

  // ── Header rows matching AMAT template ──────────────────────────────────────
  ws.addRow([
    "ACA FAI  -  Notes & Dimensions  |  Multiple rows per FAI  |  Add all rows for a Part Number before moving to the next",
  ]);
  ws.addRow([
    "  NOTE rows: fill cols A B C + E (Standard Notes) + L (Tool)     |     DIMENSION rows: fill cols A B C D F G H I J K L M     |     Keep adding rows until no more Notes/Dimensions remain for that Part Number",
  ]);
  ws.addRow([
    "REQUIRED (all row types)",
    null,
    null,
    "NOTE rows: use cols D, E     |     DIMENSION rows: use cols D, F, G, H, I, J, K, M",
  ]);

  // Column headers (row 4)
  const headerRow = ws.addRow([
    "Part Number ★\n(must match FAI Submissions)",
    "Row Type ★\n[dropdown]  NOTE or DIMENSION",
    "Feature Number ★",
    "Description\n★ DIMENSION / Optional NOTE",
    "Standard Notes\n(NOTE rows) [dropdown]",
    "Standard Notes\n(DIMENSION rows — GD&T) [dropdown]",
    "Nominal Value\n(DIMENSION only)",
    "Lower Tolerance\n(DIMENSION only)",
    "Upper Tolerance\n(DIMENSION only)",
    "Actual Value\n(DIMENSION only)",
    "Material Condition\n[dropdown]",
    "Tool ★\n[dropdown — from Tool Master List]",
    "Calibration Due Date\nMM/DD/YYYY",
    "FIR/PQR\n[dropdown]",
  ]);

  // Style header row
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: "FF000000" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
    cell.border = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    };
  });
  headerRow.height = 45;

  // Example row (row 5)
  const exRow = ws.addRow([
    "e.g. 0022-44086",
    "NOTE  or  DIMENSION",
    "e.g. 1.0",
    "Free text description",
    "Select text note",
    "e.g. FLATNESS",
    "e.g. 10.5",
    "e.g. -0.1",
    "e.g. +0.1",
    "e.g. 10.48",
    "NONE / MMC / LMC / RFS",
    "Select tool used",
    "e.g. 12/31/2026",
    "Yes / No",
  ]);
  exRow.eachCell((cell) => {
    cell.font = { italic: true, size: 9, color: { argb: "FF808080" } };
  });

  // Sort balloons by balloon number
  const sorted = [...balloons].sort((a, b) => {
    const numA = parseFloat(a.balloonNumber) || 0;
    const numB = parseFloat(b.balloonNumber) || 0;
    return numA - numB;
  });

  // Data rows
  sorted.forEach((b) => {
    const row = ws.addRow([
      session.partNumber || "",
      b.rowType,
      b.balloonNumber,
      b.description,
      b.rowType === "NOTE" ? b.standardNote : "",
      b.rowType === "DIMENSION" ? b.gdtType : "",
      b.rowType === "DIMENSION" ? b.nominalValue : "",
      b.rowType === "DIMENSION" ? b.lowerTolerance : "",
      b.rowType === "DIMENSION" ? b.upperTolerance : "",
      b.rowType === "DIMENSION" ? b.actualValue : "",
      b.rowType === "DIMENSION" ? b.materialCondition : "",
      b.tool,
      b.calibrationDueDate,
      b.firPqr,
    ]);

    row.eachCell((cell, colNum) => {
      cell.border = {
        top: { style: "hair" },
        bottom: { style: "hair" },
        left: { style: "thin" },
        right: { style: "thin" },
      };
      cell.alignment = { wrapText: false, vertical: "middle" };
      if (colNum === 1) cell.font = { bold: true, size: 10 };
      else cell.font = { size: 10 };
    });

    // Colour NOTE rows differently
    if (b.rowType === "NOTE") {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
      });
    }
  });

  // Column widths
  ws.getColumn(1).width = 18; // Part Number
  ws.getColumn(2).width = 14; // Row Type
  ws.getColumn(3).width = 14; // Feature Number
  ws.getColumn(4).width = 30; // Description
  ws.getColumn(5).width = 50; // Standard Notes (NOTE)
  ws.getColumn(6).width = 28; // GD&T
  ws.getColumn(7).width = 14; // Nominal
  ws.getColumn(8).width = 14; // Lower Tol
  ws.getColumn(9).width = 14; // Upper Tol
  ws.getColumn(10).width = 14; // Actual
  ws.getColumn(11).width = 20; // Mat Condition
  ws.getColumn(12).width = 36; // Tool
  ws.getColumn(13).width = 20; // Cal Due Date
  ws.getColumn(14).width = 10; // FIR/PQR

  ws.getRow(1).height = 20;
  ws.getRow(2).height = 20;
  ws.getRow(3).height = 20;

  // ── Generate and download ───────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `HCS_FAI_${session.partNumber || session.name}_Notes_Dimensions.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
