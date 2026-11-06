import { jsPDF } from "jspdf";
import type { PaletteColor, PixelCell, PixelGrid } from "../types";

const PAGE_W_MM = 215.9; // US Letter width
const PAGE_H_MM = 279.4; // US Letter height
const MARGIN = 14;

export function generatePdf(
  grid: PixelGrid,
  cells: PixelCell[],
  paletteColors: PaletteColor[],
  title: string,
  date: string
): void {
  const doc = new jsPDF({ unit: "mm", format: "letter", orientation: "portrait" });
  const n = grid.n;

  let cursorY = MARGIN;

  // ── Title & date row ──────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Title:", MARGIN, cursorY);
  doc.setFont("helvetica", "normal");
  const titleText = title.trim() || "_________________________________";
  doc.text(doc.splitTextToSize(titleText, PAGE_W_MM / 2 - MARGIN - 18)[0], MARGIN + 14, cursorY);

  doc.setFont("helvetica", "bold");
  doc.text("Date:", PAGE_W_MM / 2 + 2, cursorY);
  doc.setFont("helvetica", "normal");
  doc.text(date.trim() || "__________________", PAGE_W_MM / 2 + 16, cursorY);

  cursorY += 6;
  doc.setDrawColor(180);
  doc.line(MARGIN, cursorY, PAGE_W_MM - MARGIN, cursorY);
  cursorY += 6;

  // ── Grid ──────────────────────────────────────────────────────────────────
  // Available width after margins and a right-side legend column
  const legendColW = 52;
  const gridAreaW = PAGE_W_MM - MARGIN * 2 - legendColW - 4;
  const cellSize = Math.min(gridAreaW / n, (PAGE_H_MM - cursorY - MARGIN - 30) / n);
  const gridW = cellSize * n;
  const gridH = cellSize * n;
  const gridX = MARGIN;
  const gridY = cursorY;

  const colorMap: Record<string, PaletteColor> = {};
  for (const pc of paletteColors) colorMap[pc.id] = pc;

  // Draw cells — numbers scale with the cell (mm → pt is ×2.83), capped so big grids stay legible
  doc.setFontSize(Math.max(4, Math.min(14, cellSize * 2.83 * 0.4)));
  for (const cell of cells) {
    const pc = colorMap[cell.paletteColorId];
    if (!pc) continue;
    const x = gridX + cell.col * cellSize;
    const y = gridY + cell.row * cellSize;

    // Cells stay blank so the worksheet can be coloured in; only the border and number print
    doc.setDrawColor(140);
    doc.setLineWidth(0.1);
    doc.rect(x, y, cellSize, cellSize, "S");

    // Code number centered
    doc.setTextColor(40);
    doc.text(String(cell.colorCode), x + cellSize / 2, y + cellSize / 2, {
      align: "center",
      baseline: "middle",
    });
  }

  // ── Color Legend ─────────────────────────────────────────────────────────
  const legendX = gridX + gridW + 6;
  let legendY = gridY;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(30);
  doc.text("Color Legend", legendX, legendY);
  legendY += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const swatchSize = 4;
  const rowH = 5.5;

  for (const pc of paletteColors) {
    const [r, g, b] = hexToRgb(pc.finalHex);
    doc.setFillColor(r, g, b);
    doc.rect(legendX, legendY - 3, swatchSize, swatchSize, "F");
    doc.setDrawColor(120);
    doc.setLineWidth(0.1);
    doc.rect(legendX, legendY - 3, swatchSize, swatchSize, "S");

    doc.setTextColor(30);
    doc.text(`${pc.code}  ${pc.label}`, legendX + swatchSize + 2, legendY);
    legendY += rowH;
  }

  // ── Progress tracker ─────────────────────────────────────────────────────
  const trackerY = gridY + gridH + 6;
  const totalSessions = n * n;
  const useCondensed = totalSessions >= 196; // Levels 5–7

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(30);
  doc.text("Progress Log", MARGIN, trackerY);

  if (useCondensed) {
    // Tally grid: 10 sessions per row
    const sessionW = (PAGE_W_MM - MARGIN * 2) / 10;
    const sessionH = 5;
    let tx = MARGIN;
    let ty = trackerY + 5;
    doc.setFontSize(5);
    for (let i = 1; i <= totalSessions; i++) {
      doc.setFillColor(250, 250, 250);
      doc.setDrawColor(160);
      doc.setLineWidth(0.15);
      doc.rect(tx, ty, sessionW, sessionH, "FD");
      doc.setTextColor(120);
      doc.text(String(i), tx + 1, ty + 3.5);
      tx += sessionW;
      if (i % 10 === 0) {
        tx = MARGIN;
        ty += sessionH;
        if (ty + sessionH > PAGE_H_MM - MARGIN) break;
      }
    }
  } else {
    // Lined journal rows
    const lineH = 6.5;
    const rowsPerPage = Math.floor((PAGE_H_MM - trackerY - MARGIN - 12) / lineH);
    const rows = Math.min(totalSessions, rowsPerPage);
    doc.setFontSize(6.5);
    for (let i = 0; i < rows; i++) {
      const ry = trackerY + 8 + i * lineH;
      doc.setFont("helvetica", "bold");
      doc.setTextColor(100);
      doc.text(`${i + 1}`, MARGIN, ry);
      doc.setFont("helvetica", "normal");
      // Date line
      doc.setDrawColor(180);
      doc.setLineWidth(0.2);
      doc.line(MARGIN + 6, ry, MARGIN + 28, ry);
      doc.setFontSize(5.5);
      doc.setTextColor(160);
      doc.text("date", MARGIN + 6, ry - 1);
      // Notes line
      doc.setFontSize(6.5);
      doc.line(MARGIN + 30, ry, PAGE_W_MM - MARGIN, ry);
      doc.setFontSize(5.5);
      doc.text("notes", MARGIN + 30, ry - 1);
    }
  }

  const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  doc.save(`${slug || "pixel-progress"}-worksheet.pdf`);
}

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}
