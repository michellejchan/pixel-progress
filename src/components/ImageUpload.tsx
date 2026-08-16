import { useEffect, useRef, useState } from "react";
import { PixelLoader, PIXEL_LOADER_TOTAL_MS } from "./PixelLoader";

interface Props {
  onImage: (file: File) => void;
  disabled?: boolean;
  thumbnailUrl?: string;
  fileName?: string;
}

export function ImageUpload({ onImage, disabled, thumbnailUrl, fileName }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [animDone, setAnimDone] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [localFileName, setLocalFileName] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (animDone) setUploading(false);
  }, [animDone]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
  }, []);

  function handleFile(file: File | undefined) {
    if (!file) return;
    const ok = ["image/jpeg", "image/png", "image/webp", "image/heic"].includes(file.type) ||
      file.name.toLowerCase().endsWith(".heic");
    if (!ok) return;

    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    const url = URL.createObjectURL(file);
    localUrlRef.current = url;
    setLocalPreviewUrl(url);
    setLocalFileName(file.name);

    setAnimDone(false);
    setUploading(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setAnimDone(true);
    }, PIXEL_LOADER_TOTAL_MS);

    onImage(file);
  }

  const previewUrl = thumbnailUrl || localPreviewUrl;
  const previewName = fileName || localFileName;
  const showTrail = uploading;
  const showPreview = !uploading && !!previewUrl;

  return (
    <div
      className={`upload-zone${dragging ? " dragging" : ""}${disabled ? " disabled" : ""}${showPreview ? " has-preview" : ""}`}
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

      {showTrail ? (
        <PixelLoader label="Uploading…" />
      ) : showPreview ? (
        <div className="upload-preview">
          <div className="upload-thumbnail-wrap">
            <img className="upload-thumbnail" src={previewUrl!} alt="Preview" />
            {previewName && <div className="upload-filename-bar">{previewName}</div>}
            <div className="upload-thumbnail-overlay">
              <span className="upload-thumbnail-label">Upload new image</span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="upload-icon-wrapper">
            <svg className="upload-icon" viewBox="0 -960 960 960" fill="currentColor">
              <path d="M440-320v-326L336-542l-56-58 200-200 200 200-56 58-104-104v326h-80ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/>
            </svg>
          </div>
          <div className="upload-text-group">
            <p className="upload-primary"> Choose a file or drag and drop</p>
            <p className="upload-secondary">PNG or JPG</p>
          </div>
        </>
      )}
    </div>
  );
}
