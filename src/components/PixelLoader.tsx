const COUNT = 12;
const DURATION_MS = 1200;
// total time for the comet to finish its single pass across all squares
export const PIXEL_LOADER_TOTAL_MS = (COUNT - 1) * (DURATION_MS / COUNT) + DURATION_MS;

interface Props {
  label?: string;
}

export function PixelLoader({ label = "Processing…" }: Props) {
  return (
    <div className="pixel-loader">
      <div className="pixel-loader-track">
        {Array.from({ length: COUNT }, (_, i) => (
          <span
            key={i}
            className="pixel-loader-sq"
            style={{ animationDelay: `${i * (DURATION_MS / COUNT)}ms` }}
          />
        ))}
      </div>
      {label && <span className="pixel-loader-label">{label}</span>}
    </div>
  );
}
