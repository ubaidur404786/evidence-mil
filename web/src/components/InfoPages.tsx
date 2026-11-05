import { useEffect, useState } from "react";

const STEPS = [
  ["Input", "A whole-slide image of a lymph node: about 100,000 × 200,000 pixels, far too big for one model pass."],
  ["Tile", "Cut it into 224-pixel patches at 20× (≈ 112 µm each) and drop empty background. A slide gives thousands of patches."],
  ["Encode", "A frozen, pretrained pathology model (Phikon) turns each patch into 768 numbers. It is never retrained."],
  ["Aggregate", "Our small additive MIL head scores every patch and adds the scores up: slide score = Σ patch contributions + bias. It learns from slide labels only (tumour / no tumour)."],
  ["Explain", "Because the score is a sum, each patch's share is exact. The heatmap is the score itself, not an after-the-fact guess. Removing the top patches and re-running shows the score fall."],
  ["Report", "An agent writes a short report. A verifier rejects any number or patch id that is not in the evidence. A person approves or edits it. If the model is unsure it abstains."],
];

const APPROACHES = [
  {
    name: "Segmentation (U-Net and similar)",
    needs: "Pixel-level outlines of every tumour region drawn by a pathologist",
    gives: "A tumour mask; the slide decision needs an extra rule on top",
    limit: "Outlining is slow and expensive, so labelled data stays small and hard to extend to new diseases.",
  },
  {
    name: "Supervised patch classifier (CAMELYON16 winner, 2016)",
    needs: "The same pixel outlines, turned into tumour / normal patch labels",
    gives: "A probability per patch; slide score = highest patch",
    limit: "Same annotation cost; the slide score depends on one patch and is not calibrated.",
  },
  {
    name: "Attention MIL (ABMIL, CLAM)",
    needs: "Only a slide label",
    gives: "A slide score and attention weights",
    limit: "Attention says where the model looked, not whether a patch pushed the score up or down, and it does not add up to the score.",
  },
  {
    name: "EvidenceMIL (this project)",
    needs: "Only a slide label",
    gives: "A calibrated slide score that is exactly the sum of signed patch contributions, plus abstain and a verified report",
    limit: "Relies on a good frozen encoder; patches are scored independently, so very large-scale context is not modelled.",
  },
];

export function HowItWorks() {
  return (
    <div className="info">
      <h2>How EvidenceMIL works</h2>
      <p className="muted lead">A large image is a bag of small patches. The model finds which patches decided the answer and shows them.</p>
      <ol className="flow">
        {STEPS.map(([title, text], i) => (
          <li key={title} className="card">
            <span className="flow__num">{i + 1}</span>
            <div><h3>{title}</h3><p>{text}</p></div>
          </li>
        ))}
      </ol>
      <h2>How it differs from older approaches</h2>
      <div className="approaches">
        {APPROACHES.map((a) => (
          <section key={a.name} className={`card${a.name.startsWith("EvidenceMIL") ? " is-ours" : ""}`}>
            <h3>{a.name}</h3>
            <dl className="facts">
              <dt>Training labels</dt><dd>{a.needs}</dd>
              <dt>Output</dt><dd>{a.gives}</dd>
              <dt>Limitation</dt><dd>{a.limit}</dd>
            </dl>
          </section>
        ))}
      </div>
      <p className="disclaimer">Decision support for demonstration, not a medical device.</p>
    </div>
  );
}

interface Summary {
  slides: number;
  decisions_correct: number;
  abstained?: number;
  wrong?: number;
  loc_auroc: number | null;
  precision_at_10: number | null;
  chance: number | null;
}

export function Compare() {
  const [data, setData] = useState<{ summary: Record<string, Summary> } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch("replay/comparison.json").then((r) => (r.ok ? r.json() : Promise.reject())).then(setData).catch(() => setError(true));
  }, []);
  const labels: Record<string, string> = {
    "additive MIL (ours)": "slide label",
    "attention MIL": "slide label",
    "supervised patch classifier": "pixel outlines",
    "mean pooling": "slide label",
  };
  return (
    <div className="info">
      <h2>Finding the metastasis: measured on real slides</h2>
      <p className="muted lead">Same CAMELYON16 slides, same tiles and features for every method. Localisation is scored against
        the pathologists' tumour outlines. The supervised classifier is trained leave-one-slide-out on those outlines.</p>
      {error && <p className="muted">Comparison results are not available in this build.</p>}
      {data && (
        <table className="compare" data-testid="comparison">
          <thead>
            <tr><th>Method</th><th>Training labels</th><th>Slide decisions: correct / abstained / wrong</th><th>Localisation AUROC</th><th>Top-10 patches inside outline</th></tr>
          </thead>
          <tbody>
            {Object.entries(data.summary).map(([m, s]) => (
              <tr key={m} className={m.includes("ours") ? "is-ours" : ""}>
                <td>{m}</td>
                <td>{labels[m] ?? ""}</td>
                <td className="num">{s.decisions_correct} / {s.abstained ?? 0} / {s.wrong ?? 0}</td>
                <td className="num">{s.loc_auroc != null ? s.loc_auroc.toFixed(3) : "—"}</td>
                <td className="num">{s.precision_at_10 != null ? `${Math.round(s.precision_at_10 * 100)}% (chance ${Math.round((s.chance ?? 0) * 100)}%)` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">Abstained: the calibrated probability fell inside the uncertainty band, so the case is referred to a
        specialist instead of getting a possibly wrong answer. On the normal slide, attention MIL and the annotation-trained classifier
        both raise a false alarm; EvidenceMIL abstains.</p>
      <section className="card">
        <h3>Slide-level accuracy on the full CAMELYON16 test set (130 slides)</h3>
        <table className="compare">
          <thead><tr><th>Method</th><th>Training labels</th><th>Slide AUROC</th></tr></thead>
          <tbody>
            <tr><td>Mean pooling</td><td>slide label</td><td className="num">0.579 ± 0.010</td></tr>
            <tr><td>Attention MIL</td><td>slide label</td><td className="num">0.920 ± 0.008</td></tr>
            <tr className="is-ours"><td>Additive MIL (ours)</td><td>slide label</td><td className="num">0.911 ± 0.012</td></tr>
            <tr className="muted"><td>CAMELYON16 winner, Wang et al. 2016 (published, not reproduced)</td><td>pixel outlines</td><td className="num">0.925</td></tr>
          </tbody>
        </table>
        <p className="muted small">Ours and the MIL baselines: frozen Phikon features, mean ± sd over 3 seeds. Close to the annotation-trained
          winner without any pixel outlines, and the heatmap is exact.</p>
      </section>
      <p className="muted small">Prototype scale: a handful of slides for localisation. Treat differences as indicative.</p>
    </div>
  );
}

const REPO = "https://github.com/ubaidur404786/evidence-mil";
const SAMPLES = `${REPO}/releases/tag/samples-v1`;

function Cmd({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="cmd">
      <pre><code>{children}</code></pre>
      <button className="ghost" onClick={() => { navigator.clipboard?.writeText(children); setCopied(true); }}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Shown on the public (replay-only) demo when someone wants to analyse their own image. */
export function RunLocally() {
  return (
    <div className="info" data-testid="run-locally">
      <p className="eyebrow">Analyse your own image</p>
      <h2>Uploads run on your machine</h2>
      <p className="muted lead">This public page only replays recorded runs. To upload an image, run EvidenceMIL locally:
        the same pipeline (tiles → Phikon embeddings → patch scores → slide score → explanation → report) then runs live
        on your image. Nothing is sent to any server.</p>

      <ol className="guide">
        <li className="card">
          <h3>1 · Start the app (Docker)</h3>
          <p className="muted small">Needs Docker Desktop and git. Prebuilt images come from GitHub Container Registry.</p>
          <Cmd>{`git clone ${REPO}.git
cd evidence-mil
docker compose pull
docker compose up -d`}</Cmd>
          <p className="small">Open <b>http://localhost:8080</b>. The synthetic demo pack works right away, including uploads.</p>
        </li>
        <li className="card">
          <h3>2 · Enable the CAMELYON16 pack (one time, ~30–60 min on CPU)</h3>
          <p className="muted small">Needs <a href="https://docs.astral.sh/uv/" target="_blank" rel="noreferrer">uv</a>. Downloads Owkin's
            Phikon features (1.2 GB, non-commercial licence) and trains the small additive head on the CAMELYON16 training slides.</p>
          <Cmd>{`uv sync --all-packages
uv run --with huggingface_hub hf download owkin/camelyon16-features --repo-type dataset --include "data/*" --local-dir data/owkin_c16
uv run python scripts/build_cache.py --owkin data/owkin_c16/data --out data/cache_phikon
uv run python scripts/train_real.py --config ml/configs/camelyon16_phikon_additive.yaml --seeds 0`}</Cmd>
          <p className="muted small">Copy the trained head where Docker mounts it, then restart the API:</p>
          <Cmd>{`# PowerShell
New-Item -ItemType Directory -Force models/c16 | Out-Null
Copy-Item results/raw/cache_phikon_additive/* models/c16/
docker compose restart api

# macOS / Linux
mkdir -p models/c16 && cp results/raw/cache_phikon_additive/* models/c16/ && docker compose restart api`}</Cmd>
        </li>
        <li className="card">
          <h3>3 · Upload an image</h3>
          <p className="small">Click <b>Upload image</b>, choose the <b>CAMELYON16</b> pack and drop an H&amp;E region at 20× (0.5 µm/px),
            PNG or JPEG, up to 8192 px a side. Ready-made samples (CC0 crops around annotated tumour):{" "}
            <a href={SAMPLES} target="_blank" rel="noreferrer">download sample images</a>.</p>
          <p className="muted small">The first upload downloads and loads Phikon (1–2 min); a 100-patch image then takes about
            10–30 s on CPU, a few seconds on a GPU. You then get the same step-by-step pipeline as the demo cases.</p>
        </li>
      </ol>
      <p className="muted small">Without Docker: see <a href={`${REPO}/blob/main/docs/RUN_LOCALLY.md`} target="_blank" rel="noreferrer">docs/RUN_LOCALLY.md</a>.
        Decision support for demonstration, not a medical device.</p>
    </div>
  );
}
