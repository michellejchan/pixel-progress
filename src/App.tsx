import { useState, useCallback, useRef } from "react";
import LiquidMetalButton from "./components/LiquidMetalButton";
import { ImageUpload } from "./components/ImageUpload";
import { DifficultySlider } from "./components/DifficultySlider";
import { PixelGrid } from "./components/PixelGrid";
import { ColorLegend } from "./components/ColorLegend";
import { runPipeline, loadImageDataUrl } from "./lib/pipeline";
import { generatePdf } from "./lib/pdf";
import { DIFFICULTY_GRID, DIFFICULTY_LABEL } from "./types";
import type { PaletteColor, PixelCell, PixelGrid as GridType } from "./types";
import "./App.css";

type ViewMode = "color" | "code";
type AppPhase = "idle" | "processing" | "ready";

export default function App() {
  const [phase, setPhase] = useState<AppPhase>("idle");
  const [difficulty, setDifficulty] = useState(3);
  const [paletteColors, setPaletteColors] = useState<PaletteColor[]>([]);
  const [cells, setCells] = useState<PixelCell[]>([]);
  const [grid, setGrid] = useState<GridType | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("color");
  const [showBefore, setShowBefore] = useState(false);
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
      if (runId !== runIdRef.current) return; // stale run

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

  const handleRegenerate = useCallback(() => {
    if (rawDataUrlRef.current) {
      runProcessing(rawDataUrlRef.current, difficulty);
    }
  }, [difficulty, runProcessing]);

  const handleGeneratePdf = useCallback(() => {
    if (!grid || cells.length === 0 || paletteColors.length === 0) return;
    const url = generatePdf(grid, cells, paletteColors, title);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pixel-progress-level${difficulty}.pdf`;
    a.click();
  }, [grid, cells, paletteColors, title, difficulty]);

  const n = DIFFICULTY_GRID[difficulty];
  const total = n * n;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Pixel Progress</h1>
        <p className="tagline">Turn focused work into pixel art — one session at a time</p>
        <LiquidMetalButton />
      </header>

      <main className="app-main">
        <aside className="panel panel-controls">
          <section className="section">
            <h2>1. Upload Reference Image</h2>
            <ImageUpload onImage={handleImage} disabled={phase === "processing"} />
          </section>

          <section className="section">
            <h2>2. Choose Difficulty</h2>
            <DifficultySlider
              value={difficulty}
              onChange={handleDifficultyChange}
              disabled={phase === "processing"}
            />
          </section>

          <section className="section">
            <h2>3. Label Your Artwork</h2>
            <input
              type="text"
              className="text-input"
              placeholder="Artwork title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </section>

          {phase === "ready" && (
            <section className="section stats-bar">
              <div className="stat">
                <span className="stat-value">{n}×{n}</span>
                <span className="stat-label">Grid</span>
              </div>
              <div className="stat">
                <span className="stat-value">{total}</span>
                <span className="stat-label">Sessions</span>
              </div>
              <div className="stat">
                <span className="stat-value">{paletteColors.length}</span>
                <span className="stat-label">Colors</span>
              </div>
              <div className="stat-duration">
                <span>{DIFFICULTY_LABEL[difficulty]}</span>
              </div>
            </section>
          )}

          {phase === "ready" && (
            <section className="section action-buttons">
              <button className="btn btn-secondary" onClick={handleRegenerate}>
                Regenerate
              </button>
              <button className="btn btn-primary" onClick={handleGeneratePdf}>
                Generate &amp; Download PDF
              </button>
            </section>
          )}
        </aside>

        <div className="panel panel-preview">
          {phase === "idle" && (
            <div className="empty-state">
              <div className="empty-icon">🎨</div>
              <p>Upload an image to get started</p>
            </div>
          )}

          {phase === "processing" && (
            <div className="loading-state">
              <div className="spinner" />
              <p>Processing image…</p>
              <p className="loading-hint">Running multi-step downsample &amp; color harmony</p>
            </div>
          )}

          {error && <div className="error-banner">{error}</div>}

          {phase === "ready" && grid && (
            <>
              <div className="preview-header">
                <h2>Preview</h2>
                <div className="view-toggle">
                  <button
                    className={`toggle-btn ${viewMode === "color" ? "active" : ""}`}
                    onClick={() => setViewMode("color")}
                  >
                    Color
                  </button>
                  <button
                    className={`toggle-btn ${viewMode === "code" ? "active" : ""}`}
                    onClick={() => setViewMode("code")}
                  >
                    Code
                  </button>
                </div>
                {paletteColors.some((p) => p.originalHex !== p.finalHex) && (
                  <label className="before-toggle">
                    <input
                      type="checkbox"
                      checked={showBefore}
                      onChange={(e) => setShowBefore(e.target.checked)}
                    />
                    Show harmony changes
                  </label>
                )}
              </div>

              <div className="preview-body">
                {n <= 6 && viewMode === "color" && (
                  <p className="abstract-note">
                    At Level {difficulty}, pixel art is abstract — by design.
                  </p>
                )}
                <PixelGrid
                  n={grid.n}
                  cells={cells}
                  paletteColors={paletteColors}
                  view={viewMode}
                  size={Math.min(480, Math.max(240, grid.n * 20))}
                />
              </div>

              <ColorLegend paletteColors={paletteColors} showBefore={showBefore} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
