import { useState, useCallback, useRef, useEffect } from "react";
import { ImageUpload } from "./components/ImageUpload";
import { DifficultySlider } from "./components/DifficultySlider";
import { PixelGrid } from "./components/PixelGrid";
import { ColorLegend } from "./components/ColorLegend";
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

const today = new Date().toLocaleDateString("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default function App() {
  const [phase, setPhase] = useState<AppPhase>("idle");
  const [difficulty, setDifficulty] = useState(3);
  const [paletteColors, setPaletteColors] = useState<PaletteColor[]>([]);
  const [cells, setCells] = useState<PixelCell[]>([]);
  const [grid, setGrid] = useState<GridType | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    try {
      const url = await loadImageDataUrl(file);
      rawDataUrlRef.current = url;
      await runProcessing(url, difficulty);
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
    a.download = `pixel-progress-level${difficulty}.pdf`;
    a.click();
  }, [grid, cells, paletteColors, title, difficulty]);

  const n = grid ? grid.n : DIFFICULTY_GRID[difficulty];
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
      <nav className="app-nav">
        <span className="nav-arrow">{">>"}</span>
        <span className="nav-project">Pixel Project</span>
        <span className="nav-sep">/</span>
        <span className="nav-page">New session</span>
      </nav>

      <div className="app-body">
        <div className="panels">
          <span className="panel-noise" aria-hidden="true" />
          <aside className="panel-left">
            <span className="panel-noise" aria-hidden="true" />
            <div className="form-section">
              <p className="section-heading">
                {"> "}<span className="htxt">logistics</span>
              </p>

              <div className="field">
                <span className="field-label">reference</span>
                <ImageUpload onImage={handleImage} disabled={phase === "processing"} />
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
                <div className="field-value">{today}</div>
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
                    <span className="stat-val">{DIFFICULTY_TIME[difficulty]}</span>
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
                    {"[] "}<span className="htxt">legend</span>
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
