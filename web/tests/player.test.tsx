import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../src/App";
import type { Source } from "../src/api";
import { StepPlayer } from "../src/components/StepPlayer";
import { ExplainStep } from "../src/steps/Steps";
import { ReportStep } from "../src/steps/ReportStep";
import { makeEvents } from "./fixtures";

describe("StepPlayer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("auto-plays through all six steps, then replays from the start", () => {
    render(<StepPlayer events={makeEvents()} intervalMs={100} />);
    expect(screen.getByTestId("step-input")).toBeInTheDocument();
    for (const step of ["tile", "encode", "aggregate", "explain", "report"]) {
      act(() => vi.advanceTimersByTime(100));
      expect(screen.getByTestId(`step-${step}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("play-toggle")).toHaveTextContent("Play");
    fireEvent.click(screen.getByTestId("replay"));
    expect(screen.getByTestId("step-input")).toBeInTheDocument();
  });

  it("pauses", () => {
    render(<StepPlayer events={makeEvents()} intervalMs={100} />);
    fireEvent.click(screen.getByTestId("play-toggle"));
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByTestId("step-input")).toBeInTheDocument();
  });

  it("shows cached badge on encode and abstain on aggregate", () => {
    render(<StepPlayer events={makeEvents(true)} intervalMs={100} />);
    fireEvent.click(screen.getByText("Encode"));
    expect(screen.getByText("cached")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Aggregate"));
    expect(screen.getByTestId("abstain")).toBeInTheDocument();
  });
});

describe("ExplainStep", () => {
  it("contribution bars sum to the logit and what-if slider updates probability", () => {
    render(<ExplainStep events={makeEvents()} />);
    // 1.2 + 0.1 + (others -0.15) + bias -0.5 = 0.65
    expect(screen.getByTestId("logit-total")).toHaveTextContent("0.650");
    expect(screen.getByTestId("whatif")).toHaveTextContent("66.0%");
    fireEvent.change(screen.getByLabelText("patches removed"), { target: { value: "1" } });
    expect(screen.getByTestId("whatif")).toHaveTextContent("30.0%");
  });
});

describe("ReportStep", () => {
  it("approves through the callback", async () => {
    const onDecide = vi.fn(async () => ({ ...(makeEvents()[5].payload as any).report, status: "approved" }));
    render(<ReportStep events={makeEvents()} onDecide={onDecide} />);
    expect(screen.getByText("patch 1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("approve"));
    await waitFor(() => expect(screen.getByTestId("report-status")).toHaveTextContent("approved"));
    expect(onDecide).toHaveBeenCalledWith("approve", undefined);
  });

  it("abstained report has no approve button", () => {
    render(<ReportStep events={makeEvents(true)} />);
    expect(screen.getByTestId("report-status")).toHaveTextContent("abstained");
    expect(screen.queryByTestId("approve")).toBeNull();
  });
});

describe("App", () => {
  it("lists cases and runs one from the source", async () => {
    const source: Source = {
      live: false,
      listCases: async () => [{ case_id: "t-1", title: "Pattern present" }],
      run: async (_id, on) => {
        makeEvents().forEach(on);
        return "r1";
      },
      decide: async () => {
        throw new Error("no");
      },
    };
    render(<App source={source} />);
    fireEvent.click(await screen.findByText("t-1"));
    expect(await screen.findByTestId("step-input")).toBeInTheDocument();
  });
});
