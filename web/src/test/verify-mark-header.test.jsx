import React from "react";
import fs from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import App from "../App.jsx";

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy that
// call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has no demos, so there is no mark then.
const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
const health = { schema: "demo-health/1", state: "ready", runtime: "offline", demo: { id: "mcp-discovery" } };
let shelfCalls;
function mockApi(payload) {
  shelfCalls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (url === "/api/shelf") { shelfCalls.push(init); return ok(payload); }
    if (url === "/api/health") return ok(health);
    if (url === "/api/inventory") return ok({ records: [], diff: null, summary: { total: 0, byStatus: {} } });
    return ok({}, 404);
  });
}
beforeEach(() => { localStorage.clear(); });

describe("verification mark in the header", () => {
  it("shows this lab's own mark beside the Shelf link, and no other lab's", async () => {
    mockApi({ shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("in-progress", "In progress") }, { id: "mcp-discovery", verification: mark("verified", "Verified", { note: "Every scan checked on the mock" }) }] });
    render(<App />);
    const bar = within(await screen.findByTestId("top-menu"));
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every scan checked on the mock"));
    // the badge's request carries the workspace id the Shelf link sends
    expect(shelfCalls.length).toBeGreaterThan(0);
    for (const init of shelfCalls) expect(init.headers["X-Workspace-Id"]).toMatch(/^[a-z0-9][a-z0-9-]{0,31}$/);
  });

  it("shows nothing when the lab is opened on its own port (its /api/shelf has no demos) or the shelf has no mark for it", async () => {
    for (const payload of [{ shelfUrl: "http://shelf.example" }, { shelfUrl: "http://shelf.example", demos: [{ id: "mcp-discovery", verification: null }] }]) {
      mockApi(payload);
      const { unmount } = render(<App />);
      const bar = within(await screen.findByTestId("top-menu"));
      expect(await bar.findByRole("link", { name: "Shelf" })).toBeInTheDocument(); // the shelf answered, and still no badge
      expect(document.querySelector(".verify")).toBeNull();
      unmount();
    }
  });

  it("renders the badge from App.jsx with this lab's shelf id (removing the line must fail this test)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "App.jsx"), "utf8");
    expect(src.match(/<VerifyMark\b[^>]*\bid="mcp-discovery"/g)).toHaveLength(1);
    const entry = JSON.parse(fs.readFileSync(path.join(process.cwd(), "..", "docs", "shelf-entry.json"), "utf8"));
    expect(entry.demos[0].id).toBe("mcp-discovery");
  });
});
