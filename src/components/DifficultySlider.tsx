interface Props {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}

export function DifficultySlider({ value, onChange, disabled }: Props) {
  return (
    <div className="diff-section">
      <span className="diff-label">level</span>
      <div className="diff-grid">
        {[1, 2, 3, 4, 5, 6, 7].map((level) => (
          <button
            key={level}
            className={`diff-btn${level === value ? " active" : ""}`}
            onClick={() => onChange(level)}
            disabled={disabled}
          >
            {level}
          </button>
        ))}
      </div>
    </div>
  );
}
