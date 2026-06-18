import { DIFFICULTY_GRID, DIFFICULTY_LABEL } from "../types";

interface Props {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}

export function DifficultySlider({ value, onChange, disabled }: Props) {
  const n = DIFFICULTY_GRID[value];
  const total = n * n;
  const label = DIFFICULTY_LABEL[value];

  return (
    <div className="difficulty-control">
      <div className="difficulty-header">
        <label htmlFor="difficulty-slider">
          Difficulty <span className="difficulty-badge">Level {value}</span>
        </label>
        <span className="difficulty-meta">
          {n}×{n} grid · {total} sessions · {label}
        </span>
      </div>
      <input
        id="difficulty-slider"
        type="range"
        min={1}
        max={7}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider"
      />
      <div className="slider-labels">
        {[1, 2, 3, 4, 5, 6, 7].map((l) => (
          <span key={l} className={l === value ? "active" : ""}>{l}</span>
        ))}
      </div>
    </div>
  );
}
