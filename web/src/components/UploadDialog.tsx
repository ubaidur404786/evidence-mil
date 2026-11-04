import { useState, type DragEvent } from "react";
import type { CaseSummary, PackInfo } from "../types";

interface Props {
  packs: PackInfo[];
  onUpload: (file: File, pack: string) => Promise<CaseSummary>;
  onDone: (c: CaseSummary) => void;
  onClose: () => void;
}

export function UploadDialog({ packs, onUpload, onDone, onClose }: Props) {
  const usable = packs.filter((p) => p.upload);
  const [pack, setPack] = useState(usable[0]?.name ?? "");
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const info = usable.find((p) => p.name === pack);

  async function submit() {
    if (!file || !pack) return;
    setBusy(true);
    setError(undefined);
    try {
      onDone(await onUpload(file, pack));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="upload image">
      <div className="modal__body">
        <header className="card__head">
          <h3>Analyse a new image</h3>
          <button className="icon" aria-label="close" onClick={onClose}>×</button>
        </header>
        <label className="field">
          <span>Model pack</span>
          <select value={pack} onChange={(e) => setPack(e.target.value)}>
            {usable.map((p) => <option key={p.name} value={p.name}>{p.title}</option>)}
          </select>
        </label>
        {info && (
          <p className="muted small">
            The image is cut into {info.patch_px} px tiles{info.tile_um ? ` (${info.tile_um} µm at 20× ≈ 0.5 µm/px)` : ""},
            background is dropped and each tile is encoded live. Use an image at the pack's magnification.
          </p>
        )}
        <div className={`drop${file ? " has-file" : ""}`} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <input id="file" type="file" accept="image/png,image/jpeg,image/tiff" onChange={(e) => setFile(e.target.files?.[0])} />
          <label htmlFor="file">{file ? `${file.name} · ${(file.size / 1e6).toFixed(1)} MB` : "Drop a PNG / JPEG / TIFF here, or click to choose"}</label>
        </div>
        <p className="muted small">Processed on this server only; nothing is sent to third parties. Max 64 MB, 8192 px per side.
          Whole-slide files go through the offline extraction script.</p>
        {error && <p className="bad">{error}</p>}
        <div className="actions">
          <button onClick={submit} disabled={!file || busy}>{busy ? "Tiling and saving…" : "Upload and analyse"}</button>
          <button className="ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
