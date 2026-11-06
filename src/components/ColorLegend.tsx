import type { PaletteColor } from "../types";

interface Props {
  paletteColors: PaletteColor[];
}

export function ColorLegend({ paletteColors }: Props) {
  if (paletteColors.length === 0) return null;
  return (
    <div className="legend-grid">
      {paletteColors.map((pc) => (
        <div key={pc.id} className="legend-row">
          <span className="legend-swatch" style={{ background: pc.finalHex }} />
          <span className="legend-code">{pc.code}:</span>
          <span className="legend-name">{pc.label}</span>
        </div>
      ))}
    </div>
  );
}
