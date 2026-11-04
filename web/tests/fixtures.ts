import type { StepEvent } from "../src/types";

const thumb = "data:image/png;base64,iVBORw0KGgo=";
const coords = [
  [0, 0],
  [0, 1],
  [1, 0],
  [1, 1],
];

export function makeEvents(abstain = false, withReference = false): StepEvent[] {
  const patches = [0.1, 1.2, -0.2, 0.05].map((c, i) => ({
    patch_id: i,
    row: coords[i][0],
    col: coords[i][1],
    attention: 0.25,
    contribution: c,
  }));
  const evidence = {
    case_id: "t-1",
    logit: 0.65,
    bias: -0.5,
    probability: abstain ? 0.52 : 0.66,
    abstain,
    patches,
    top_k: [1, 0],
    deletion_curve: [
      { removed: 0, probability: 0.66 },
      { removed: 1, probability: 0.3 },
      { removed: 2, probability: 0.28 },
    ],
  };
  const report = {
    case_id: "t-1",
    status: abstain ? "abstained" : "draft",
    sections: [{ title: "Summary", text: "Probability 66.0%, driven by patch 1.", citations: [1] }],
    verifier: { passed: true, errors: [] },
  };
  const p = [
    { thumbnail: thumb, overlay: withReference ? thumb : null, title: "Pattern present", domain: "toy", source: "", note: "",
      reference_label: 1, image_size: [32, 32] },
    { rows: 2, cols: 2, coords, n_patches: 4, reference: withReference ? [0, 1, 0, 0] : null },
    { encoder: "fake", dim: 8, projection: [[0, 0], [1, 1], [-1, 0], [0.5, -0.5]] },
    { head: "additive", logit: 0.65, bias: -0.5, probability: evidence.probability, temperature: 1, abstain,
      abstain_band: [0.4, 0.6], attention: [0.25, 0.25, 0.25, 0.25] },
    { evidence, patch_images: { "1": thumb },
      localisation: withReference ? { annotated_patches: 1, chance: 0.25, auroc: 1, precision_at_1: 1, precision_at_5: 0.25, precision_at_10: 0.25 } : null },
    { report },
  ];
  const steps = ["input", "tile", "encode", "aggregate", "explain", "report"] as const;
  return steps.map((step, index) => ({ case_id: "t-1", step, index, payload: p[index], cached: step === "encode", elapsed_ms: 1 }));
}
