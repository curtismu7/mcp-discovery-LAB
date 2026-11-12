import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../App.jsx";
import ModeToggle from "../components/ModeToggle.jsx";
import { RECORDS, SUMMARY, FIRST_DIFF } from "./fixtures.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Mock/Real toggle (rule 19)", () => {
  it("no live setting: Mock is pressed and Real is disabled with how to enable it", () => {
    render(<ModeToggle info={{ mode: "local", hosted: false, source: "mock", realAvailable: false }} onSelect={() => {}} />);
    expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("mode-real")).toBeDisabled();
    expect(screen.getByTestId("mode-real")).toHaveAttribute("title", expect.stringMatching(/MCP_DISCOVERY_LIVE=1/));
  });

  it("hosted: Real is disabled saying the hosted build is Mock only", () => {
    render(<ModeToggle info={{ mode: "se-mock", hosted: true, source: "mock", realAvailable: false }} onSelect={() => {}} />);
    expect(screen.getByTestId("mode-real")).toBeDisabled();
    expect(screen.getByTestId("mode-real")).toHaveAttribute("title", "The hosted build is Mock only.");
  });

  it("when Real is available the buttons switch both ways and the pressed one does nothing", () => {
    const picked = [];
    const { rerender } = render(<ModeToggle info={{ hosted: false, source: "mock", realAvailable: true }} onSelect={(s) => picked.push(s)} />);
    fireEvent.click(screen.getByTestId("mode-mock"));
    expect(picked).toEqual([]);
    fireEvent.click(screen.getByTestId("mode-real"));
    expect(picked).toEqual(["real"]);
    rerender(<ModeToggle info={{ hosted: false, source: "real", realAvailable: true }} onSelect={(s) => picked.push(s)} />);
    fireEvent.click(screen.getByTestId("mode-mock"));
    expect(picked).toEqual(["real", "mock"]);
  });

  it("before the server answers both buttons are disabled", () => {
    render(<ModeToggle info={null} onSelect={() => {}} />);
    expect(screen.getByTestId("mode-mock")).toBeDisabled();
    expect(screen.getByTestId("mode-real")).toBeDisabled();
  });

  it("switching Real to Mock tells the server, then reloads health (the LIVE banner goes) and the inventory", async () => {
    let source = "real"; const calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const method = init.method || "GET"; calls.push(`${method} ${url}`);
      const ok = (body) => ({ ok: true, status: 200, json: async () => body });
      if (url === "/api/health") return ok({ schema: "demo-health/1", state: "ready", runtime: source === "real" ? "live" : "offline" });
      if (url === "/api/info") return ok({ mode: "local", hosted: false, source, realAvailable: true });
      if (url === "/api/mode") { source = JSON.parse(init.body).source; return ok({ mode: "local", hosted: false, source, realAvailable: true }); }
      if (url === "/api/inventory") return ok(source === "real" ? { records: [], diff: null, summary: { total: 0, byStatus: {} } } : { records: RECORDS, diff: FIRST_DIFF, summary: SUMMARY });
      return { ok: false, status: 404, json: async () => ({}) };
    });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("live-banner")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("mode-select")).toHaveValue("real"));
    fireEvent.change(screen.getByTestId("mode-select"), { target: { value: "mock" } });
    await waitFor(() => expect(screen.getByTestId("mode-select")).toHaveValue("mock"));
    await waitFor(() => expect(screen.queryByTestId("live-banner")).toBeNull());
    expect(calls).toContain("POST /api/mode");
    expect(screen.getByTestId("mode-badge")).toHaveTextContent("DEMO MODE");
  });
});
