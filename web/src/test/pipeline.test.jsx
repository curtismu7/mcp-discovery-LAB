import React from "react";
import { act, render, screen } from "@testing-library/react";
import Pipeline, { buildSteps } from "../components/Pipeline.jsx";
import { RECORDS, RUG_DIFF } from "./fixtures.js";

describe("buildSteps", () => {
  it("uses real numbers from the scan", () => {
    const steps = buildSteps(RECORDS, RUG_DIFF);
    expect(steps).toHaveLength(5);
    expect(steps[1].text).toContain("5 candidates");
    expect(steps[2].text).toContain("4 probed, 1 listed but not probed");
    expect(steps[3].text).toContain("2 findings across 1 hostile");
    expect(steps[4].text).toContain("Possible rug-pull");
  });
  it("says so when there is no scan", () => {
    expect(buildSteps([], null)[0].text).toContain("Run a scan");
  });
});

describe("Pipeline", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("Simulate walks the steps, the caption is a live region, Reset clears it", () => {
    render(<Pipeline records={RECORDS} diff={RUG_DIFF} theme="light" />);
    const cap = screen.getByTestId("caption");
    expect(cap).toHaveAttribute("aria-live", "polite");
    expect(cap).toHaveTextContent("Press Simulate");
    act(() => { screen.getByRole("button", { name: "Simulate" }).click(); });
    expect(cap).toHaveTextContent("Step 1 of 5");
    expect(screen.getByRole("button", { name: "Simulate" })).toBeDisabled();
    act(() => { vi.advanceTimersByTime(1800); });
    expect(cap).toHaveTextContent("Step 2 of 5");
    for (let i = 0; i < 3; i++) act(() => { vi.advanceTimersByTime(1700); });
    expect(cap).toHaveTextContent("Step 5 of 5");
    expect(cap).toHaveTextContent("Possible rug-pull");
    expect(document.querySelector(".story li.now")).not.toBeNull();
    act(() => { screen.getByRole("button", { name: "Reset diagram" }).click(); });
    expect(cap).toHaveTextContent("Press Simulate");
    expect(screen.getByRole("button", { name: "Simulate" })).not.toBeDisabled();
  });

  it("speed control shortens the step time", () => {
    render(<Pipeline records={RECORDS} diff={RUG_DIFF} theme="dark" />);
    const sel = screen.getByLabelText("Speed");
    act(() => { sel.value = "4"; sel.dispatchEvent(new Event("change", { bubbles: true })); });
    act(() => { screen.getByRole("button", { name: "Simulate" }).click(); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByTestId("caption")).toHaveTextContent("Step 2 of 5");
  });
});
