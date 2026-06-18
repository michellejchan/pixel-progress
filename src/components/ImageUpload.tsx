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
      <div className="upload-icon">🖼</div>
      <p>Drop an image here or click to upload</p>
      <p className="upload-hint">JPG, PNG, WEBP, HEIC supported</p>
    </div>
  );
}
