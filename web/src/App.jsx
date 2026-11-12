import React, { useCallback, useEffect, useRef, useState } from "react";
import fs from "node:fs";
import ShelfLink from "./components/ShelfLink.jsx";
import TopMenu, { applyFontSize } from "./top-menu/TopMenu.jsx";
import { getHealth, getInfo, getInventory, postReset, postScan, setMode } from "./lib/api.js";
import Inventory, { SummaryChips } from "./components/Inventory.jsx";
import Drawer from "./components/Drawer.jsx";
import DiffPanel from "./components/DiffPanel.jsx";
import Pipeline from "./components/Pipeline.jsx";
import Story from "./components/Story.jsx";
import { workspaceId } from "./lib/api.js";

const LAB_VERSION = (() => { try { return JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version || null; } catch { return null; } })();

const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const initialTheme = () => safe(() => localStorage.getItem("mcpd-theme"), null)
  || (safe(() => window.matchMedia("(prefers-color-scheme: dark)").matches, false) ? "dark" : "light");

export default function App() {
  const [theme, setTheme] = useState(initialTheme);
  const [fontStep, setFontStep] = useState(() => { const f = safe(() => localStorage.getItem("mcpd-font"), null); return ["S", "M", "L"].includes(f) ? f : "M"; });
  const [view, setView] = useState("inventory");
  const [health, setHealth] = useState(null);
  const [info, setInfo] = useState(null);
  const [snap, setSnap] = useState({ records: [], diff: null, summary: null });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
  const opener = useRef(null);

  useEffect(() => {
    if (theme === "auto" || theme === "") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    safe(() => localStorage.setItem("mcpd-theme", theme));
  }, [theme]);
  useEffect(() => { applyFontSize(fontStep); safe(() => localStorage.setItem("mcpd-font", fontStep)); }, [fontStep]);

  useEffect(() => {
    getHealth().then(setHealth, () => setHealth({ unreachable: true }));
    getInfo().then(setInfo, () => {});
    getInventory().then(
      (d) => setSnap({ records: d.records, diff: d.records.length ? d.diff : null, summary: d.summary }),
      (e) => setError(`Could not load the inventory: ${e.message}`));
  }, []);

  const scan = useCallback(async () => {
    setBusy(true); setError(""); setMessage("Scanning");
    try {
      const d = await postScan();
      setSnap({ records: d.records, diff: d.diff, summary: d.summary });
      const by = d.summary.byStatus;
      const rug = d.diff.changed.filter((c) => c.possibleRugPull).length;
      setMessage(`Scan complete: ${d.summary.total} records, ${by.hostile || 0} hostile, ${by.offline || 0} offline, ${by.degraded || 0} degraded.${rug ? ` Possible rug-pull detected on ${rug} server${rug > 1 ? "s" : ""}.` : ""}`);
    } catch (e) { setMessage(""); setError(`Scan failed: ${e.message}`); } finally { setBusy(false); }
  }, []);

  const reset = useCallback(async () => {
    setBusy(true); setError("");
    try {
      await postReset();
      setSnap({ records: [], diff: null, summary: null }); setOpenId(null);
      setMessage("Inventory cleared. The next scan is a new baseline.");
    } catch (e) { setError(`Reset failed: ${e.message}`); } finally { setBusy(false); }
  }, []);

  // Rule 19: the Mock/Real toggle. Switching changes what every call reads, so health (the LIVE banner) and the inventory are loaded again.
  const selectMode = useCallback(async (source) => {
    setBusy(true); setError("");
    try {
      setInfo(await setMode(source));
      setOpenId(null);
      const [h, d] = await Promise.all([getHealth(), getInventory()]);
      setHealth(h); setSnap({ records: d.records, diff: d.records.length ? d.diff : null, summary: d.summary });
      setMessage(`Mode: ${source === "real" ? "Real" : "Mock"}.`);
    } catch (e) { setError(`Could not switch mode: ${e.message}`); } finally { setBusy(false); }
  }, []);

  const open = (id, el) => { opener.current = el; setOpenId(id); };
  const close = () => { setOpenId(null); opener.current?.focus?.(); };

  const live = health?.runtime === "live";
  const hosted = health?.mode === "se-mock";
  const dark = theme === "dark";
  return (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      {live && (
        <div className="banner" data-state="live" role="alert" data-testid="live-banner">
          <strong>LIVE MODE.</strong> This server is reading this machine: processes, listening ports, Docker and the client configs you listed. Read-only, loopback and stdio only, secrets redacted. Not a demo.
        </div>
      )}
      {hosted && (
        <div className="banner hosted" role="status" data-testid="hosted-banner">
          <strong>HOSTED SIMULATION.</strong> Every server, tool and finding here is synthetic and the real host is never read. Your workspace is private to this browser tab and held in memory only; it is dropped after a while.
        </div>
      )}
      {health?.unreachable && <div className="banner warn" role="alert">Cannot reach the discovery API. Is the server running? <span data-testid="unreachable-sim-note">If this is the hosted build, everything shown here is still a simulation.</span></div>}
      {health && !health.unreachable && health.state !== "ready" && <div className="banner warn" role="alert">Server health is {health.state}. Run <code>npm run doctor</code>.</div>}
      <header className="top">
        <h1>MCP Discovery</h1>
        {health && !health.unreachable && (
          <span className={`mode ${live ? "mode--live" : "mode--demo"}`} data-testid="mode-badge">{live ? "LIVE" : hosted ? "HOSTED SIMULATION" : "DEMO MODE"}<span className="sr-only">{live ? ": reading this machine" : hosted ? ": hosted, offline fixtures and stubs" : ": offline fixtures and stubs"}</span></span>
        )}
        <nav aria-label="Views">
          <button type="button" className="tab" aria-pressed={view === "inventory"} onClick={() => setView("inventory")}>Inventory</button>
          <button type="button" className="tab" aria-pressed={view === "pipeline"} onClick={() => setView("pipeline")}>Pipeline</button>
        </nav>
        <TopMenu
          mode={{ value: info?.source === "real" ? "real" : "mock", onChange: selectMode, realAvailable: info ? (!info.hosted && info.realAvailable === true) : null, realHint: info?.hosted ? "The hosted build is Mock only." : "Real scans this machine (read-only). Start the server with MCP_DISCOVERY_LIVE=1, then switch." }}
          extra={<button type="button" className="btn primary" onClick={scan} disabled={busy}>Scan</button>}
          theme={{ value: theme, onChange: setTheme }}
          fontSize={{ value: fontStep, onChange: setFontStep }}
          help={{ href: "https://github.com/curtismu7/mcp-discovery-LAB#readme" }}
          version={LAB_VERSION}
          onReset={reset}
        >
          <ShelfLink headers={() => ({ "X-Workspace-Id": workspaceId() })} />
        </TopMenu>
      </header>
      <main id="main" tabIndex={-1} className="page">
        <div role="status" aria-live="polite" className="scan-status" data-testid="scan-status">{message}</div>
        {error && <p className="alert" role="alert">{error}</p>}
        {view === "inventory" ? (
          <>
            <SummaryChips summary={snap.summary} />
            <div className={openId ? "split" : ""}>
              <div>
                <Inventory records={snap.records} onOpen={open} openId={openId} />
              </div>
              {openId && <Drawer id={openId} onClose={close} />}
            </div>
            <DiffPanel diff={snap.diff} />
            <Story />
          </>
        ) : <Pipeline records={snap.records} diff={snap.diff} theme={theme} />}
      </main>
    </>
  );
}
