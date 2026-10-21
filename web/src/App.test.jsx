import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";
import { RECORDS, SUMMARY, FIRST_DIFF, RUG_DIFF, POISONED } from "./test/fixtures.js";

let health, inv, scans;
function mockApi() {
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    const m = init.method || "GET";
    if (url === "/api/health") return ok(health);
    if (url === "/api/inventory") return ok(inv);
    if (url === "/api/scan" && m === "POST") return ok(scans.shift());
    if (url === "/api/reset" && m === "POST") { inv = { records: [], diff: null, summary: { total: 0, byStatus: {} } }; return ok({ ok: true }); }
    if (url.startsWith("/api/inventory/")) {
      const r = [...RECORDS].find((x) => x.id === decodeURIComponent(url.split("/").pop()));
      return r ? ok({ record: r }) : ok({ error: "not_found", message: "no such inventory record" }, 404);
    }
    return ok({}, 404);
  });
}
const demoHealth = { schema: "demo-health/1", state: "ready", runtime: "offline", demo: { id: "mcp-discovery" } };
const scanBody = (diff) => ({ mode: "demo", records: RECORDS, diff, summary: SUMMARY, diagnostics: [] });

beforeEach(() => {
  health = demoHealth; inv = { records: [], diff: null, summary: { total: 0, byStatus: {} } };
  scans = [scanBody(FIRST_DIFF), scanBody(RUG_DIFF)];
  localStorage.clear(); mockApi();
});

describe("App", () => {
  it("shows the demo badge and no live banner in demo mode", async () => {
    render(<App />);
    expect(await screen.findByTestId("mode-badge")).toHaveTextContent("DEMO MODE");
    expect(screen.queryByTestId("live-banner")).toBeNull();
  });
  it("shows a loud live banner and a LIVE badge when health says live", async () => {
    health = { ...demoHealth, runtime: "live" };
    render(<App />);
    expect(await screen.findByTestId("live-banner")).toHaveTextContent("LIVE MODE");
    expect(screen.getByTestId("live-banner")).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("mode-badge")).toHaveTextContent("LIVE");
  });
  it("warns when the API is unreachable", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("down"); });
    render(<App />);
    expect(await screen.findByText(/Cannot reach the discovery API/)).toBeInTheDocument();
  });

  it("scan fills the inventory and announces the result in a live region", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Scan" }));
    const status = screen.getByTestId("scan-status");
    expect(status).toHaveAttribute("aria-live", "polite");
    await waitFor(() => expect(status).toHaveTextContent("Scan complete: 5 records, 1 hostile, 1 offline, 1 degraded."));
    expect(screen.getByTestId("row-mcp-poison")).toHaveTextContent("hostile");
    expect(screen.getByText(/First scan: this is the baseline/)).toBeInTheDocument();
  });
  it("a second scan shows the rug-pull and announces it", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Scan" }));
    await waitFor(() => expect(screen.getByTestId("scan-status")).toHaveTextContent("Scan complete"));
    await userEvent.click(screen.getByRole("button", { name: "Scan" }));
    await waitFor(() => expect(screen.getByTestId("rugpull")).toBeInTheDocument());
    expect(screen.getByTestId("scan-status")).toHaveTextContent("Possible rug-pull detected on 1 server");
  });
  it("sends no body and no credential headers", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Scan" }));
    await waitFor(() => screen.getByTestId("row-mcp-poison"));
    const [, init] = fetch.mock.calls.find(([u]) => u === "/api/scan");
    expect(init.body).toBeUndefined();
    expect(Object.keys(init.headers)).toEqual(["Accept"]);
  });
  it("reset clears the inventory and the diff", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Scan" }));
    await waitFor(() => screen.getByTestId("row-mcp-poison"));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(screen.getByText(/Inventory is empty/)).toBeInTheDocument());
    expect(screen.getByText(/No scan yet/)).toBeInTheDocument();
  });
  it("shows an error if a scan fails", async () => {
    scans = [];
    globalThis.fetch = vi.fn(async (u, i) => (u === "/api/scan" ? { ok: false, status: 500, json: async () => ({ error: "server_error" }) } : { ok: true, status: 200, json: async () => (u === "/api/health" ? demoHealth : inv) }));
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Scan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Scan failed");
  });

  it("opens the drawer from the keyboard, shows the record as inert text, Escape returns focus", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Scan" }));
    await waitFor(() => screen.getByTestId("row-mcp-poison"));
    const opener = within(screen.getByTestId("row-mcp-poison")).getByRole("button");
    opener.focus();
    await userEvent.keyboard("{Enter}");
    const dlg = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dlg).getByText("Findings (2)")).toBeInTheDocument());
    expect(dlg).toHaveAccessibleName(/node 5312/);
    expect(dlg.querySelector("img")).toBeNull();
    expect(dlg.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(dlg.querySelectorAll(".chip").length).toBeGreaterThan(0);
    expect(dlg.textContent).toContain("[U+200B]");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
    expect(POISONED.status).toBe("hostile");
  });

  it("toggles dark and light and remembers the choice", async () => {
    render(<App />);
    const btn = screen.getByRole("button", { name: /Switch to (dark|light) theme/ });
    const before = document.documentElement.getAttribute("data-theme");
    await userEvent.click(btn);
    const after = document.documentElement.getAttribute("data-theme");
    expect(after).not.toBe(before);
    expect(localStorage.getItem("mcpd-theme")).toBe(after);
  });
  it("switches to the pipeline view", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Pipeline" }));
    expect(screen.getByRole("button", { name: "Simulate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pipeline" })).toHaveAttribute("aria-pressed", "true");
  });

  it("a11y basics: skip link, landmarks, every button named, unique ids, no purple tokens", async () => {
    render(<App />);
    await screen.findByTestId("mode-badge");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Views" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const b of screen.getAllByRole("button")) expect(b).toHaveAccessibleName();
    const ids = Array.from(document.querySelectorAll("[id]")).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const css = (await import("node:fs")).readFileSync(`${process.cwd()}/src/app.css`, "utf8");
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/prefers-reduced-motion/);
    // No purple: no colour in the stylesheet has a hue between 265 and 320 degrees (greys have no hue).
    for (const [, hex] of css.matchAll(/#([0-9a-f]{6})\b/gi)) {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max - min < 0.12) continue;
      let h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
      h = (h * 60 + 360) % 360;
      expect(h < 265 || h > 320, `#${hex} has hue ${Math.round(h)}`).toBe(true);
    }
  });
});
