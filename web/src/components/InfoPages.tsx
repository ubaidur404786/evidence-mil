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
