import type { CaseSummary, Report, StepEvent } from "./types";

// Two sources: the live API (behind /api) or static recorded runs in /replay (offline-safe demo).
const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export interface Source {
  live: boolean;
  listCases(): Promise<CaseSummary[]>;
  run(caseId: string, onEvent: (e: StepEvent) => void): Promise<string>;
  decide(runId: string, action: "approve" | "edit", sections?: Report["sections"]): Promise<Report>;
}

async function json<T>(resp: Response): Promise<T> {
  if (!resp.ok) throw new Error(`${resp.status} ${await resp.text()}`);
  return (await resp.json()) as T;
}

export const liveSource: Source = {
  live: true,
  listCases: async () => json<CaseSummary[]>(await fetch(`${API}/cases`)),
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
};

export const replaySource: Source = {
  live: false,
  listCases: async () => json<CaseSummary[]>(await fetch("replay/index.json")),
  async run(caseId, onEvent) {
    const events = await json<StepEvent[]>(await fetch(`replay/${caseId}.json`));
    events.forEach(onEvent);
    return `replay-${caseId}`;
  },
  async decide() {
    throw new Error("Replay mode is read-only: approve is shown locally only.");
  },
};

export async function pickSource(): Promise<Source> {
  if (new URLSearchParams(window.location.search).has("replay")) return replaySource;
  try {
    const r = await fetch(`${API}/health`);
    if (r.ok) return liveSource;
  } catch {
    /* fall through to replay */
  }
  return replaySource;
}
