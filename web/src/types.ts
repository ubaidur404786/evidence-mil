// Shared types come from contracts/generated/ts (single source of truth).
import type { Evidence } from "@contracts/Evidence";
import type { Report } from "@contracts/Report";
import type { StepEvent } from "@contracts/StepEvent";

export type { Evidence, Report, StepEvent };

export const STEPS = ["input", "tile", "encode", "aggregate", "explain", "report"] as const;
export type StepName = (typeof STEPS)[number];

export const STEP_LABELS: Record<StepName, string> = {
  input: "Input",
  tile: "Tile",
  encode: "Encode",
  aggregate: "Aggregate",
  explain: "Explain",
  report: "Report",
};

export const STEP_CAPTIONS: Record<StepName, string> = {
  input: "A large image. Is something important inside it?",
  tile: "Cut it into small patches and drop empty background.",
  encode: "A frozen, pretrained vision model turns each patch into a vector.",
  aggregate: "A small model weighs the patches and gives one score.",
  explain: "The score is exactly the sum of patch contributions. Remove the top ones and it falls.",
  report: "A report is drafted, every number is checked, and a person signs off.",
};

export interface CaseSummary {
  case_id: string;
  pack?: string;
  title?: string;
  domain?: string;
  source?: string;
  label?: number | null;
  n_patches?: number | null;
  has_annotation?: boolean;
  uploaded?: boolean;
}

export interface PackInfo {
  name: string;
  title: string;
  upload: boolean;
  patch_px: number;
  tile_um: number | null;
}

export interface Localisation {
  annotated_patches: number;
  chance: number;
  auroc: number;
  precision_at_1: number;
  precision_at_5: number;
  precision_at_10: number;
}

/** Everything the dashboard needs about one run, derived from the six StepEvents. */
export interface CaseView {
  caseId: string;
  input: {
    thumbnail: string;
    overlay: string | null;
    title: string;
    domain: string;
    source: string;
    note: string;
    referenceLabel: number | null;
    imageSize: [number, number];
  };
  tile: { rows: number; cols: number; coords: [number, number][]; reference: number[] | null; tileUm: number | null };
  encode: { encoder: string; dim: number; projection: [number, number][]; cached: boolean };
  aggregate: {
    head: string;
    logit: number;
    bias: number;
    probability: number;
    temperature: number;
    abstain: boolean;
    band: [number, number];
    attention: number[];
  };
  evidence: Evidence;
  patchImages: Record<string, string>;
  localisation: Localisation | null;
  report: Report | null;
  elapsedMs: number[];
}
