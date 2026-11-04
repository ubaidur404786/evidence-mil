import type { CaseView, Evidence, Report, StepEvent } from "../types";

type P = Record<string, any>; // stage payloads are free-form in the contract; shapes in ARCHITECTURE.md §2

/** Build the dashboard view model from the six step events (null until all six arrived). */
export function deriveView(events: StepEvent[]): CaseView | null {
  const by = (s: string) => events.find((e) => e.step === s);
  const steps = ["input", "tile", "encode", "aggregate", "explain", "report"].map(by);
  if (steps.some((e) => !e)) return null;
  const [input, tile, encode, aggregate, explain, report] = steps.map((e) => (e!.payload ?? {}) as P);
  const rep = report.report as P | undefined;
  return {
    caseId: steps[0]!.case_id,
    input: {
      thumbnail: input.thumbnail,
      overlay: input.overlay ?? null,
      title: input.title ?? "",
      domain: input.domain ?? "",
      source: input.source ?? "",
      note: input.note ?? "",
      referenceLabel: input.reference_label ?? null,
      imageSize: input.image_size ?? [0, 0],
    },
    tile: {
      rows: tile.rows,
      cols: tile.cols,
      coords: tile.coords ?? [],
      reference: tile.reference ?? null,
      tileUm: tile.tile_um ?? null,
    },
    encode: {
      encoder: encode.encoder,
      dim: encode.dim,
      projection: encode.projection ?? [],
      cached: Boolean(steps[2]!.cached),
    },
    aggregate: {
      head: aggregate.head,
      logit: aggregate.logit,
      bias: aggregate.bias,
      probability: aggregate.probability,
      temperature: aggregate.temperature,
      abstain: aggregate.abstain,
      band: aggregate.abstain_band ?? [0.4, 0.6],
      attention: aggregate.attention ?? [],
    },
    evidence: explain.evidence as Evidence,
    patchImages: explain.patch_images ?? {},
    localisation: explain.localisation ?? null,
    report: rep && "status" in rep ? (rep as Report) : null,
    elapsedMs: steps.map((e) => e!.elapsed_ms ?? 0),
  };
}

export function pct(p: number, digits = 1): string {
  return `${(p * 100).toFixed(digits)}%`;
}

export function signed(x: number, digits = 3): string {
  return `${x >= 0 ? "+" : ""}${x.toFixed(digits)}`;
}

/** Patch ids ordered by contribution, largest first. */
export function rankByContribution(ev: Evidence): number[] {
  return [...ev.patches].sort((a, b) => b.contribution - a.contribution).map((p) => p.patch_id);
}

export function verdict(view: CaseView): { label: string; tone: "pos" | "neg" | "warn" } {
  if (view.aggregate.abstain) return { label: "Abstains: refer to specialist", tone: "warn" };
  return view.aggregate.probability >= 0.5
    ? { label: "Positive: evidence of the target finding", tone: "pos" }
    : { label: "Negative: no evidence of the target finding", tone: "neg" };
}

export type ReportStatus = Report["status"];
