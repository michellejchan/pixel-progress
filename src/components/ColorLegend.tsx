import type { PaletteColor } from "../types";

interface Props {
  paletteColors: PaletteColor[];
  showBefore?: boolean;
}

export function ColorLegend({ paletteColors, showBefore = false }: Props) {
  if (paletteColors.length === 0) return null;
  return (
    <div className="color-legend">
      <h3>Color Legend</h3>
      <ul>
        {paletteColors.map((pc) => (
          <li key={pc.id} className="legend-row">
            <span className="code-badge">{pc.code}</span>
            <span
              className="swatch"
              style={{ background: pc.finalHex }}
              title={pc.finalHex}
            />
            {showBefore && pc.originalHex !== pc.finalHex && (
              <span
                className="swatch swatch-before"
                style={{ background: pc.originalHex }}
                title={`Before: ${pc.originalHex}`}
              />
            )}
            <span className="color-label">{pc.label}</span>
            <span className="color-hex">{pc.finalHex}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
