// Shared types come from contracts/generated/ts (single source of truth).
export type { StepEvent } from "@contracts/StepEvent";
export type { Evidence } from "@contracts/Evidence";
export type { Report } from "@contracts/Report";

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
  title?: string;
  domain?: string;
  label?: number | null;
}
