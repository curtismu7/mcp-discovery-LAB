import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Inventory from "../components/Inventory.jsx";
import DiffPanel from "../components/DiffPanel.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { RECORDS, FIRST_DIFF, RUG_DIFF, POISONED } from "./fixtures.js";

describe("status rendering", () => {
  it.each(["candidate", "healthy", "review", "hostile", "offline", "degraded"])("%s is shown as a word, not colour alone", (s) => {
    render(<StatusBadge status={s} />);
    expect(screen.getByText(s)).toBeInTheDocument();
    expect(document.querySelector(".glyph")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Inventory", () => {
  it("shows every record with status, sources, confidence, transport, tools and findings", () => {
    render(<Inventory records={RECORDS} onOpen={() => {}} />);
    expect(screen.getAllByRole("row")).toHaveLength(RECORDS.length + 1);
    const row = screen.getByTestId("row-mcp-poison");
    expect(within(row).getByText("hostile")).toBeInTheDocument();
    expect(within(row).getByText("listeners")).toBeInTheDocument();
    expect(within(row).getByText("lookup_note")).toBeInTheDocument();
    expect(row).toHaveTextContent("2 (1 high)");
    expect(within(screen.getByTestId("row-mcp-clean")).getByText("listeners, processes")).toBeInTheDocument();
    expect(within(screen.getByTestId("row-mcp-stdio")).getByText("stdio")).toBeInTheDocument();
  });
  it("has a caption, column headers and row headers for screen readers", () => {
    render(<Inventory records={RECORDS} onOpen={() => {}} />);
    expect(screen.getByRole("table", { name: "Discovered MCP servers" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(7);
    expect(screen.getAllByRole("rowheader")).toHaveLength(RECORDS.length);
  });
  it("opens a record from the keyboard", async () => {
    const onOpen = vi.fn();
    render(<Inventory records={RECORDS} onOpen={onOpen} />);
    const b = screen.getByRole("button", { name: /node 5312/ });
    b.focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith("mcp-poison", b);
  });
  it("renders a hostile server name as text", () => {
    const evil = { ...POISONED, id: "x", displayName: "<b onmouseover=1>evil</b>​" };
    const { container } = render(<Inventory records={[evil]} onOpen={() => {}} />);
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b onmouseover=1>evil</b>[U+200B]");
  });
  it("tells the user what to do when empty", () => {
    render(<Inventory records={[]} onOpen={() => {}} />);
    expect(screen.getByText(/Inventory is empty/)).toBeInTheDocument();
  });
});

describe("DiffPanel", () => {
  it("says the first scan is a baseline", () => {
    render(<DiffPanel diff={FIRST_DIFF} />);
    expect(screen.getByText(/First scan: this is the baseline/)).toBeInTheDocument();
  });
  it("highlights a possible rug-pull with before and after hashes", () => {
    render(<DiffPanel diff={RUG_DIFF} />);
    const rug = screen.getByTestId("rugpull");
    expect(rug).toHaveTextContent("POSSIBLE RUG-PULL");
    expect(rug).toHaveTextContent("mcp-forecast");
    expect(rug).toHaveTextContent("Metadata hash before");
    expect(rug).toHaveTextContent("1662db300b2f");
    expect(rug).toHaveTextContent("Metadata hash after");
    expect(rug).toHaveTextContent("43fe10b8b74b");
    expect(rug).toHaveTextContent("get_forecast");
    expect(rug).toHaveTextContent("healthy");
  });
  it("shows new, changed and gone counts and an empty state", () => {
    const { rerender } = render(<DiffPanel diff={{ ...RUG_DIFF, gone: [{ id: "g", displayName: "old", status: "healthy" }] }} />);
    expect(screen.getByRole("heading", { name: "Changed (1)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Gone (1)" })).toBeInTheDocument();
    rerender(<DiffPanel diff={null} />);
    expect(screen.getByText(/No scan yet/)).toBeInTheDocument();
  });
});
