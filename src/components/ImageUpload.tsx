import { useRef, useState } from "react";

interface Props {
  onImage: (file: File) => void;
  disabled?: boolean;
}

export function ImageUpload({ onImage, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleFile(file: File | undefined) {
    if (!file) return;
    const ok = ["image/jpeg", "image/png", "image/webp", "image/heic"].includes(file.type) ||
      file.name.toLowerCase().endsWith(".heic");
    if (!ok) return;
    onImage(file);
  }

  return (
    <div
      className={`upload-zone ${dragging ? "dragging" : ""} ${disabled ? "disabled" : ""}`}
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled) handleFile(e.dataTransfer.files[0]);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.heic"
        style={{ display: "none" }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <svg className="upload-diamond" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 2L22 12L12 22L2 12Z" />
        <line x1="12" y1="8" x2="12" y2="16" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </svg>
      <div className="upload-text-group">
        <p className="upload-primary">Drag image here</p>
        <p className="upload-secondary">or click to browse</p>
      </div>
    </div>
  );
}
