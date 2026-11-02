// Rule 19: the Mock / Real toggle. Mock is the demo. Real scans this machine (read-only) and exists only when the server was started
// with MCP_DISCOVERY_LIVE=1; the page can switch to it and back, never enable it. The hosted build is Mock only.
const REAL_HOW = "Real scans this machine (read-only). Start the server with MCP_DISCOVERY_LIVE=1, then switch.";
const HOSTED = "The hosted build is Mock only.";

export default function ModeToggle({ info, onSelect, busy = false }) {
  const loading = !info;
  const source = info?.source;
  const hosted = info?.hosted === true;
  const realOff = loading || hosted || info?.realAvailable !== true;
  const pick = (next) => { if (next !== source) onSelect?.(next); };
  return (
    <div className="mode-toggle" role="group" aria-label="Mode" data-testid="mode">
      <button type="button" aria-pressed={source === "mock"} disabled={loading || busy} onClick={() => pick("mock")} data-testid="mode-mock">Mock</button>
      <button type="button" aria-pressed={source === "real"} disabled={realOff || busy} title={hosted ? HOSTED : realOff && !loading ? REAL_HOW : undefined} onClick={() => pick("real")} data-testid="mode-real">Real</button>
    </div>
  );
}
