import type { CaseSummary, PackInfo, Report, StepEvent } from "./types";

// Two sources: the live API (behind /api) or recorded runs in /replay (offline-safe public demo).
const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? "api";

export interface Source {
  live: boolean;
  listCases(): Promise<CaseSummary[]>;
  listPacks(): Promise<PackInfo[]>;
  run(caseId: string, onEvent: (e: StepEvent) => void): Promise<string>;
  decide(runId: string, action: "approve" | "edit", sections?: Report["sections"]): Promise<Report>;
  upload?(file: File, pack: string): Promise<CaseSummary>;
  /** URL of a patch image, or null when not available (replay mode). */
  patchUrl(caseId: string, patchId: number): string | null;
}

async function json<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let detail = await resp.text();
    try {
      detail = JSON.parse(detail).detail ?? detail;
    } catch {
      /* plain text error */
    }
    throw new Error(`${resp.status}: ${detail}`);
  }
  return (await resp.json()) as T;
}

export const liveSource: Source = {
  live: true,
  listCases: async () => json<CaseSummary[]>(await fetch(`${API}/cases`)),
  listPacks: async () => json<PackInfo[]>(await fetch(`${API}/packs`)),
  async run(caseId, onEvent) {
    const { run_id } = await json<{ run_id: string }>(
      await fetch(`${API}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_id: caseId }),
      }),
    );
    await new Promise<void>((resolve, reject) => {
      const es = new EventSource(`${API}/runs/${run_id}/events`);
      es.addEventListener("step", (m) => onEvent(JSON.parse((m as MessageEvent).data)));
      es.addEventListener("done", () => {
        es.close();
        resolve();
      });
      es.onerror = () => {
        es.close();
        reject(new Error("event stream failed"));
      };
    });
    return run_id;
  },
  decide: async (runId, action, sections) =>
    json<Report>(
      await fetch(`${API}/runs/${runId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sections }),
      }),
    ),
  async upload(file, pack) {
    const form = new FormData();
    form.append("file", file);
    form.append("pack", pack);
    return json<CaseSummary>(await fetch(`${API}/uploads`, { method: "POST", body: form }));
  },
  patchUrl: (caseId, patchId) => `${API}/cases/${caseId}/patches/${patchId}`,
};

export const replaySource: Source = {
  live: false,
  listCases: async () => json<CaseSummary[]>(await fetch("replay/index.json")),
  listPacks: async () => [],
  async run(caseId, onEvent) {
    const events = await json<StepEvent[]>(await fetch(`replay/${caseId}.json`));
    events.forEach(onEvent);
    return `replay-${caseId}`;
  },
  async decide() {
    throw new Error("Replay mode is read-only: the decision is recorded in this browser only.");
  },
  patchUrl: () => null,
};

export async function pickSource(): Promise<Source> {
  if (new URLSearchParams(window.location.search).has("replay")) return replaySource;
  try {
    const r = await fetch(`${API}/health`);
    if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) return liveSource;
  } catch {
    /* fall through to replay */
  }
  return replaySource;
}
