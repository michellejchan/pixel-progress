import { useState, useCallback, useRef, useEffect } from "react";
import { ImageUpload } from "./components/ImageUpload";
import { DifficultySlider } from "./components/DifficultySlider";
import { PixelGrid } from "./components/PixelGrid";
import { PixelScramble } from "./components/PixelScramble";
import { ColorLegend } from "./components/ColorLegend";
import { TopNav } from "./components/TopNav";
import { KoiPond } from "./components/KoiPond";
import type { Session } from "./components/TopNav";
import { runPipeline, loadImageDataUrl, warmUpPipeline } from "./lib/pipeline";
import { DIFFICULTY_GRID } from "./types";
import type { PaletteColor, PixelCell, PixelGrid as GridType } from "./types";
import "./App.css";

type AppPhase = "idle" | "processing" | "ready";

// Minimum time the scramble stays on screen at normal pace, so it reads as a deliberate
// transition; the speed-up burst (SCRAMBLE_FINISH_MS) plays after this
const SCRAMBLE_MIN_MS = 600;

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
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  );
  const [error, setError] = useState<string | null>(null);
  const [croppedDataUrl, setCroppedDataUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");

  const [committed, setCommitted] = useState<{
    grid: GridType;
    cells: PixelCell[];
    paletteColors: PaletteColor[];
    difficulty: number;
  } | null>(null);

  const [gridView, setGridView] = useState<"color" | "code">("color");
  const [exporting, setExporting] = useState(false);

  const [showGlitch, setShowGlitch] = useState(false);
  const glitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Once the scramble is no longer needed it stays up for its speed-up burst, then hides
  const scrambleWanted = phase === "processing" || showGlitch;
  const [scrambleFinishing, setScrambleFinishing] = useState(false);
  const [prevScrambleWanted, setPrevScrambleWanted] = useState(scrambleWanted);
  // Updated during render (not in an effect) so the overlay never unmounts for a frame
  if (prevScrambleWanted !== scrambleWanted) {
    setPrevScrambleWanted(scrambleWanted);
    setScrambleFinishing(!scrambleWanted);
  }
  const handleScrambleDone = useCallback(() => setScrambleFinishing(false), []);
  const scrambleActive = scrambleWanted || scrambleFinishing;
  // Grid size to scramble at before the first result exists
  const pendingN = difficulty !== null ? DIFFICULTY_GRID[difficulty] : DIFFICULTY_GRID[1];

  const rawDataUrlRef = useRef<string | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => () => {
    if (glitchTimerRef.current) clearTimeout(glitchTimerRef.current);
  }, []);

  const triggerGlitch = useCallback(() => {
    if (glitchTimerRef.current) clearTimeout(glitchTimerRef.current);
    setShowGlitch(true);
    glitchTimerRef.current = setTimeout(() => setShowGlitch(false), SCRAMBLE_MIN_MS);
  }, []);

  const runProcessing = useCallback(async (imageDataUrl: string, diff: number) => {
    const runId = ++runIdRef.current;
    // Scramble shows for every run, including the first, so it's clear work is happening
    triggerGlitch();
    setPhase("processing");
    setError(null);

    const n = DIFFICULTY_GRID[diff];
    const paletteId = crypto.randomUUID();
    const gridId = crypto.randomUUID();

    try {
      const start = performance.now();
      const result = await runPipeline(imageDataUrl, diff, paletteId, gridId);
      const elapsed = performance.now() - start;
      await new Promise(resolve => setTimeout(resolve, Math.max(elapsed / 8, 150)));
      if (runId !== runIdRef.current) return;

      const g: GridType = {
        id: gridId,
        projectId: "",
        n,
        cellSizeMm: parseFloat((190 / n).toFixed(1)),
        totalCells: n * n,
      };

      setCroppedDataUrl(result.croppedDataUrl);
      setPhase("ready");
      setCommitted({ grid: g, cells: result.cells, paletteColors: result.paletteColors, difficulty: diff });
    } catch (e) {
      console.error(e);
      if (runId === runIdRef.current) {
        setError("Processing failed. Please try a different image.");
        setPhase("idle");
      }
    }
  }, [triggerGlitch]);

  const handleImage = useCallback(async (file: File) => {
    warmUpPipeline();
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

  // Exports what's on screen (committed), not the live settings. jsPDF is loaded on demand.
  const handleGeneratePdf = useCallback(async () => {
    if (!committed || phase === "processing" || exporting) return;
    setExporting(true);
    try {
      const { generatePdf } = await import("./lib/pdf");
      generatePdf(committed.grid, committed.cells, committed.paletteColors, title, date);
    } catch (e) {
      console.error(e);
      setError("Could not generate the PDF.");
    } finally {
      setExporting(false);
    }
  }, [committed, phase, exporting, title, date]);

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
                  thumbnailUrl={croppedDataUrl ?? undefined}
                  fileName={fileName || undefined}
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

              <div className="field">
                <span className="field-label">title</span>
                <input
                  className="field-input"
                  placeholder="Untitled pixel"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <DifficultySlider
                value={difficulty}
                onChange={handleDifficultyChange}
              />
            </div>

            {/* Reprocessing on level change stays silent here; clicks during it are ignored */}
            <button
              className="btn-generate"
              onClick={handleGeneratePdf}
              disabled={!committed}
            >
              Generate PDF
            </button>
          </aside>

          <div className="panel-right">
            <span className="panel-noise" aria-hidden="true" />
            <div className="grid-section" ref={gridSectionRef}>
              {error && <div className="error-banner">{error}</div>}

              {committed && (
                <div className="grid-header">
                  <p className="section-heading">
                    {"> "}<span className="htxt">preview</span>
                  </p>
                  <div className="view-toggle" role="group" aria-label="Grid view">
                    {(["color", "code"] as const).map((v) => (
                      <button
                        key={v}
                        className={`view-toggle-btn${gridView === v ? " active" : ""}`}
                        aria-pressed={gridView === v}
                        onClick={() => setGridView(v)}
                      >
                        {v === "color" ? "Color" : "Numbers"}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {committed || scrambleActive ? (
                <div className="grid-canvas-wrap">
                  <div className="grid-canvas-container">
                    {committed && (
                      <PixelGrid
                        n={committed.grid.n}
                        cells={committed.cells}
                        paletteColors={committed.paletteColors}
                        view={gridView}
                        size={canvasSize}
                      />
                    )}
                    {/* Always mounted so the scramble never waits on a fresh canvas; hidden when idle.
                        Before the first result it stands alone as the board, then overlays the grid. */}
                    <div className={`grid-scramble-overlay${scrambleActive ? "" : " idle"}${committed ? "" : " standalone"}`}>
                      <PixelScramble
                        size={canvasSize}
                        n={committed?.grid.n ?? pendingN}
                        active={scrambleActive}
                        finishing={!scrambleWanted}
                        onDone={handleScrambleDone}
                      />
                    </div>
                  </div>
                  {committed ? (
                    <div className="grid-stats">
                      <span className="stat-key">Grid</span>
                      <span className="stat-val">{committed.grid.n}×{committed.grid.n}</span>
                      <div className="stat-divider" />
                      <span className="stat-key">Sessions</span>
                      <span className="stat-val">{committed.grid.n * committed.grid.n}</span>
                      <div className="stat-divider" />
                      <span className="stat-key">Time</span>
                      <span className="stat-val">{DIFFICULTY_TIME[committed.difficulty]}</span>
                    </div>
                  ) : (
                    <span className="empty-state-caption">Processing…</span>
                  )}
                </div>
              ) : (
                <div className="grid-empty">
                  <KoiPond />
                  <span className="empty-state-caption">Nothing here yet</span>
                </div>
              )}
            </div>

            {committed && committed.paletteColors.length > 0 && (
              <>
                <div className="section-divider" />
                <div className="legend-section">
                  <p className="section-heading">
                    {"> "}<span className="htxt">Color legend</span>
                  </p>
                  <ColorLegend paletteColors={committed.paletteColors} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
