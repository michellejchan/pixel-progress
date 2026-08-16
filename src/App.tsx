import { useState, useCallback, useRef, useEffect } from "react";
import { ImageUpload } from "./components/ImageUpload";
import { DifficultySlider } from "./components/DifficultySlider";
import { PixelGrid } from "./components/PixelGrid";
import { ColorLegend } from "./components/ColorLegend";
import { TopNav } from "./components/TopNav";
import type { Session } from "./components/TopNav";
import { runPipeline, loadImageDataUrl } from "./lib/pipeline";
import { generatePdf } from "./lib/pdf";
import { DIFFICULTY_GRID } from "./types";
import type { PaletteColor, PixelCell, PixelGrid as GridType } from "./types";
import emptyStateImg from "./assets/pixel_drink-removebg-preview.png";
import "./App.css";

type AppPhase = "idle" | "processing" | "ready";

const DIFFICULTY_TIME: Record<number, string> = {
  1: "~2 HRS",
  2: "~0.5 DAYS",
  3: "~1 WEEK",
  4: "~2.5 WKS",
  5: "~5 WKS",
  6: "~8 WKS",
  7: "~13 WKS",
};

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([
    { id: crypto.randomUUID(), name: "New session" },
  ]);
  const [activeSessionIdx, setActiveSessionIdx] = useState(0);

  function handleCycle(direction: -1 | 1) {
    setActiveSessionIdx(
      (i) => (i + direction + sessions.length) % sessions.length
    );
  }

  function handleRename(index: number, name: string) {
    setSessions((prev) =>
      prev.map((s, i) => (i === index ? { ...s, name } : s))
    );
  }

  const [phase, setPhase] = useState<AppPhase>("idle");
  const [difficulty, setDifficulty] = useState<number | null>(null);
  const [paletteColors, setPaletteColors] = useState<PaletteColor[]>([]);
  const [cells, setCells] = useState<PixelCell[]>([]);
  const [grid, setGrid] = useState<GridType | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [croppedDataUrl, setCroppedDataUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");

  const rawDataUrlRef = useRef<string | null>(null);
  const runIdRef = useRef(0);

  const runProcessing = useCallback(async (imageDataUrl: string, diff: number) => {
    const runId = ++runIdRef.current;
    setPhase("processing");
    setError(null);
    setCells([]);
    setPaletteColors([]);
    setGrid(null);

    const n = DIFFICULTY_GRID[diff];
    const paletteId = crypto.randomUUID();
    const gridId = crypto.randomUUID();

    try {
      const result = await runPipeline(imageDataUrl, diff, paletteId, gridId);
      if (runId !== runIdRef.current) return;

      const g: GridType = {
        id: gridId,
        projectId: "",
        n,
        cellSizeMm: parseFloat((190 / n).toFixed(1)),
        totalCells: n * n,
      };

      setGrid(g);
      setPaletteColors(result.paletteColors);
      setCells(result.cells);
      setCroppedDataUrl(result.croppedDataUrl);
      setPhase("ready");
    } catch (e) {
      console.error(e);
      if (runId === runIdRef.current) {
        setError("Processing failed. Please try a different image.");
        setPhase("idle");
      }
    }
  }, []);

  const handleImage = useCallback(async (file: File) => {
    setError(null);
    setFileName(file.name);
    setCroppedDataUrl(null);
    try {
      const url = await loadImageDataUrl(file);
      rawDataUrlRef.current = url;
      if (difficulty !== null) {
        await runProcessing(url, difficulty);
      }
    } catch (e) {
      console.error(e);
      setError("Could not load image.");
    }
  }, [difficulty, runProcessing]);

  const handleDifficultyChange = useCallback((v: number) => {
    setDifficulty(v);
    if (rawDataUrlRef.current) {
      runProcessing(rawDataUrlRef.current, v);
    }
  }, [runProcessing]);

  const handleGeneratePdf = useCallback(() => {
    if (!grid || cells.length === 0 || paletteColors.length === 0) return;
    const url = generatePdf(grid, cells, paletteColors, title);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pixel-progress-level${difficulty ?? "custom"}.pdf`;
    a.click();
  }, [grid, cells, paletteColors, title, difficulty]);

  const n = grid?.n ?? 0;
  const total = n * n;

  const gridSectionRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState(360);

  useEffect(() => {
    const el = gridSectionRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      if (w > 0) setCanvasSize(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="app">
      <TopNav
        sessions={sessions}
        activeIndex={activeSessionIdx}
        onCycle={handleCycle}
        onRename={handleRename}
      />

      <div className="app-body">
        <div className="panels">
          <span className="panel-noise" aria-hidden="true" />
          <aside className="panel-left">
            <span className="panel-noise" aria-hidden="true" />
            <div className="form-section">
              <p className="section-heading">
                {"> "}<span className="htxt">setup</span>
              </p>

              <div className="field">
                <ImageUpload
                  onImage={handleImage}
                  disabled={phase === "processing"}
                  thumbnailUrl={croppedDataUrl ?? undefined}
                  fileName={fileName || undefined}
                />
              </div>

              <div className="field">
                <span className="field-label">title</span>
                <input
                  className="field-input"
                  placeholder="Untitled pixel"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="field">
                <span className="field-label">date</span>
                <input
                  className="field-input"
                  placeholder="—"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>

              <DifficultySlider
                value={difficulty}
                onChange={handleDifficultyChange}
                disabled={phase === "processing"}
              />
            </div>

            <button
              className="btn-generate"
              onClick={handleGeneratePdf}
              disabled={phase !== "ready"}
            >
              Preview
            </button>
          </aside>

          <div className="panel-right">
            <span className="panel-noise" aria-hidden="true" />
            <div className="grid-section" ref={gridSectionRef}>
              {error && <div className="error-banner">{error}</div>}

              {phase === "ready" && grid ? (
                <div className="grid-canvas-wrap">
                  <PixelGrid
                    n={grid.n}
                    cells={cells}
                    paletteColors={paletteColors}
                    view="color"
                    size={canvasSize}
                  />
                  <div className="grid-stats">
                    <span className="stat-key">Grid</span>
                    <span className="stat-val">{n}×{n}</span>
                    <div className="stat-divider" />
                    <span className="stat-key">Sessions</span>
                    <span className="stat-val">{total}</span>
                    <div className="stat-divider" />
                    <span className="stat-key">Time</span>
                    <span className="stat-val">{difficulty !== null ? DIFFICULTY_TIME[difficulty] : "—"}</span>
                  </div>
                </div>
              ) : (
                <div className="grid-empty">
                  {phase === "processing" ? (
                    <>
                      <div className="spinner" />
                      <span>Processing image…</span>
                    </>
                  ) : (
                    <>
                      <img src={emptyStateImg} className="empty-state-img" alt="" />
                      <span className="empty-state-caption">Nothing here yet</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {phase === "ready" && paletteColors.length > 0 && (
              <>
                <div className="section-divider" />
                <div className="legend-section">
                  <p className="section-heading">
                    {"> "}<span className="htxt">Color legend</span>
                  </p>
                  <ColorLegend paletteColors={paletteColors} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
