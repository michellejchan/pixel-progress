// Difficulty level → maximum palette size, background included. Kept small on purpose:
// most people own a basic pencil/marker set, not ten shades of green. The pipeline can
// end up with fewer if colours are too similar to be worth separating.
export const DIFFICULTY_PALETTE_SIZE: Record<number, number> = {
  1: 3,
  2: 4,
  3: 5,
  4: 6,
  5: 7,
  6: 8,
  7: 10,
};

// Difficulty level → grid dimension mapping
export const DIFFICULTY_GRID: Record<number, number> = {
  1: 4,
  2: 6,
  3: 7,
  4: 10,
  5: 14,
  6: 18,
  7: 23,
};

export const DIFFICULTY_LABEL: Record<number, string> = {
  1: "~2 hours (focused morning)",
  2: "~half a day",
  3: "~1 week",
  4: "~2.5 weeks",
  5: "~5 weeks",
  6: "~8 weeks",
  7: "~13 weeks",
};

export type ProjectStatus = "draft" | "generated" | "printed";

export interface Project {
  id: string;
  title: string;
  startDate: string; // ISO date string
  difficultyLevel: number; // 1–7
  sessionDurationMin: number; // default 45
  status: ProjectStatus;
}

export interface ReferenceImage {
  id: string;
  projectId: string;
  originalFilename: string;
  mimeType: string;
  originalWidthPx: number;
  originalHeightPx: number;
  dataUrl: string; // base64 of decoded image
  downsampledDataUrl: string; // after multi-step canvas downsample
}

export interface ColorPalette {
  id: string;
  projectId: string;
  paletteSize: number; // max colours, scales with difficulty: 3/4/5/6/7/8/10
  createdAt: string;
  harmonyPassApplied: boolean;
}

export interface PaletteColor {
  id: string;
  paletteId: string;
  code: number; // 1–N (where N = palette size for the difficulty level)
  label: string; // e.g. "Dusty Rose"
  originalHex: string; // raw MMCQ output
  finalHex: string; // after harmony pass
  lchL: number;
  lchC: number;
  lchH: number;
}

export interface PixelGrid {
  id: string;
  projectId: string;
  n: number; // grid dimension
  cellSizeMm: number;
  totalCells: number; // n²
}

export interface PixelCell {
  id: string;
  gridId: string;
  row: number;
  col: number;
  paletteColorId: string;
  colorCode: number; // 1–N (denormalized from PaletteColor)
}

export interface PrintSheet {
  id: string;
  projectId: string;
  generatedAt: string;
  paperSize: string; // "US Letter"
  orientation: "portrait" | "landscape";
  blobUrl: string;
  includesProgressMargin: boolean;
}

// Aggregate state used in the app
export interface AppState {
  project: Project;
  referenceImage: ReferenceImage | null;
  palette: ColorPalette | null;
  paletteColors: PaletteColor[];
  grid: PixelGrid | null;
  cells: PixelCell[];
  printSheet: PrintSheet | null;
}
