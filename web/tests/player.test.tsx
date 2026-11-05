import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../src/App";
import type { Source } from "../src/api";
import { CaseWorkspace } from "../src/components/CaseWorkspace";
import { FlowRunner } from "../src/components/FlowRunner";
import { Decomposition, LocalisationCard, WhatIf } from "../src/components/EvidencePanels";
import { ReportPanel } from "../src/components/ReportPanel";
import { deriveView } from "../src/lib/derive";
import type { Report } from "../src/types";
import { makeEvents } from "./fixtures";

const view = (abstain = false, ref = false) => deriveView(makeEvents(abstain, ref))!;
const noUrl = () => null;

describe("deriveView", () => {
  it("needs all six events", () => {
    expect(deriveView(makeEvents().slice(0, 5))).toBeNull();
    const v = view();
    expect(v.aggregate.probability).toBe(0.66);
    expect(v.encode.cached).toBe(true);
    expect(v.report?.status).toBe("draft");
  });
});

describe("CaseWorkspace pipeline", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("auto-plays through all six steps, then replays from the start", () => {
    render(<CaseWorkspace view={view()} intervalMs={100} patchUrl={noUrl} />);
    expect(screen.getByTestId("step-input")).toBeInTheDocument();
    for (const step of ["tile", "encode", "aggregate", "explain", "report"]) {
      act(() => vi.advanceTimersByTime(100));
      expect(screen.getByTestId(`step-${step}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("report-status")).toHaveTextContent("draft");
    expect(screen.getByTestId("play-toggle")).toHaveTextContent("Play");
    fireEvent.click(screen.getByTestId("replay"));
    expect(screen.getByTestId("step-input")).toBeInTheDocument();
  });

  it("pauses", () => {
    render(<CaseWorkspace view={view()} intervalMs={100} patchUrl={noUrl} />);
    fireEvent.click(screen.getByTestId("play-toggle"));
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByTestId("step-input")).toBeInTheDocument();
  });

  it("shows abstain on the score card and a gallery of top patches", () => {
    render(<CaseWorkspace view={view(true)} intervalMs={100} patchUrl={noUrl} />);
    fireEvent.click(screen.getByText("Explain"));
    fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));
    expect(screen.getByTestId("abstain")).toBeInTheDocument();
    expect(screen.getByTestId("patch-gallery").querySelectorAll("button")).toHaveLength(1);
  });

  it("opens the patch inspector from the gallery", () => {
    render(<CaseWorkspace view={view()} intervalMs={100} patchUrl={noUrl} />);
    fireEvent.click(screen.getByText("Explain"));
    fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));
    fireEvent.click(screen.getByAltText("patch 1"));
    expect(screen.getByTestId("patch-inspector")).toHaveTextContent("Patch 1");
    expect(screen.getByTestId("patch-inspector")).toHaveTextContent("+1.200");
  });
});

describe("FlowRunner", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("processes, pops up each stage, docks it on Next, then finishes", () => {
    render(<FlowRunner view={view()} processMs={100} dwellMs={1000} patchUrl={noUrl} />);
    expect(screen.getByTestId("processing")).toBeInTheDocument();
    const keys = ["input", "tile", "encode", "score", "aggregate", "explain", "report"];
    keys.forEach((k) => {
      act(() => vi.advanceTimersByTime(100));
      expect(screen.getByTestId(`pop-${k}`)).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("pop-next"));
      act(() => vi.advanceTimersByTime(600));
      expect(screen.queryByTestId(`pop-${k}`)).toBeNull();
    });
    expect(screen.getByTestId("flow-done")).toHaveTextContent("66.0%");
  });

  it("shows patches, instance scores and the additive sum", () => {
    render(<FlowRunner view={view()} processMs={10} dwellMs={1000} patchUrl={noUrl} />);
    const step = () => { fireEvent.click(screen.getByTestId("pop-next")); act(() => vi.advanceTimersByTime(600)); };
    act(() => vi.advanceTimersByTime(10));
    step();
    act(() => vi.advanceTimersByTime(10));
    expect(screen.getByTestId("patch-scroll").querySelectorAll("figure").length).toBe(view().tile.coords.length);
    step(); act(() => vi.advanceTimersByTime(10));
    step(); act(() => vi.advanceTimersByTime(10));
    expect(screen.getByTestId("instances").firstElementChild).toHaveTextContent("Patch #1");
    step(); act(() => vi.advanceTimersByTime(10));
    expect(screen.getByTestId("flow-logit")).toHaveTextContent("+0.650");
  });

  it("auto runs to the end", () => {
    render(<FlowRunner view={view()} processMs={10} dwellMs={50} patchUrl={noUrl} />);
    fireEvent.click(screen.getByTestId("flow-auto"));
    for (let i = 0; i < 90; i++) act(() => vi.advanceTimersByTime(100));
    expect(screen.getByTestId("flow-done")).toBeInTheDocument();
  });
});

describe("evidence panels", () => {
  it("contribution bars sum to the logit", () => {
    render(<Decomposition view={view()} />);
    // 1.2 + 0.1 + (others -0.15) + bias -0.5 = 0.65
    expect(screen.getByTestId("logit-total")).toHaveTextContent("0.650");
  });

  it("what-if slider reports the deletion curve", () => {
    const onChange = vi.fn();
    const { rerender } = render(<WhatIf view={view()} removed={0} onChange={onChange} />);
    expect(screen.getByTestId("whatif")).toHaveTextContent("66.0%");
    fireEvent.change(screen.getByLabelText("patches removed"), { target: { value: "1" } });
    expect(onChange).toHaveBeenCalledWith(1);
    rerender(<WhatIf view={view()} removed={1} onChange={onChange} />);
    expect(screen.getByTestId("whatif")).toHaveTextContent("30.0%");
  });

  it("localisation card only when an annotation exists", () => {
    const { container } = render(<LocalisationCard view={view()} />);
    expect(container).toBeEmptyDOMElement();
    render(<LocalisationCard view={view(false, true)} />);
    expect(screen.getByTestId("localisation")).toHaveTextContent("25%");
  });
});

describe("ReportPanel", () => {
  it("approves through the callback", async () => {
    const report = view().report!;
    const onDecide = vi.fn(async (): Promise<Report> => ({ ...report, status: "approved" }));
    render(<ReportPanel report={report} onDecide={onDecide} />);
    expect(screen.getByText("patch 1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("approve"));
    await waitFor(() => expect(screen.getByTestId("report-status")).toHaveTextContent("approved"));
    expect(onDecide).toHaveBeenCalledWith("approve", undefined);
  });

  it("abstained report has no approve button", () => {
    render(<ReportPanel report={view(true).report} />);
    expect(screen.getByTestId("report-status")).toHaveTextContent("abstained");
    expect(screen.queryByTestId("approve")).toBeNull();
  });
});

describe("App", () => {
  const source = (live: boolean): Source => ({
    live,
    listCases: async () => [{ case_id: "t-1", title: "Pattern present", domain: "toy" }],
    listPacks: async () => [{ name: "toy", title: "Toy", upload: true, patch_px: 16, tile_um: null }],
    run: async (_id, on) => {
      makeEvents().forEach(on);
      return "r1";
    },
    decide: async () => {
      throw new Error("no");
    },
    upload: async () => ({ case_id: "up-1", title: "mine.png", uploaded: true }),
    patchUrl: () => null,
  });

  it("lists cases, runs one and records it in the worklist", async () => {
    render(<App source={source(false)} intervalMs={50} />);
    fireEvent.click(await screen.findByText("t-1"));
    expect(await screen.findByTestId("flow")).toBeInTheDocument();
    expect((await screen.findAllByText("66%")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "Review workstation" }));
    expect(await screen.findByTestId("step-input")).toBeInTheDocument();
    expect(screen.queryByTestId("upload-open")).toBeNull(); // replay mode: no uploads, a guide instead
    fireEvent.click(screen.getByTestId("upload-guide"));
    expect(screen.getByTestId("run-locally")).toHaveTextContent("docker compose pull");
  });

  it("uploads in live mode and opens the new case", async () => {
    render(<App source={source(true)} intervalMs={50} />);
    fireEvent.click(await screen.findByTestId("upload-open"));
    const input = screen.getByLabelText(/Drop a PNG/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "mine.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByText("Upload and analyse"));
    expect(await screen.findByText("up-1")).toBeInTheDocument();
  });
});

describe("errorGuide", () => {
  it("turns API errors into next steps", async () => {
    const { errorGuide } = await import("../src/components/RunProgress");
    expect(errorGuide("Failed to fetch").title).toMatch(/reach the API/);
    expect(errorGuide("422: no tissue found").title).toMatch(/cannot be analysed/);
    expect(errorGuide("500: OutOfMemoryError: CUDA out of memory").title).toMatch(/memory/);
    expect(errorGuide("500: Internal Server Error").tips[0]).toMatch(/Retry/);
  });
});
