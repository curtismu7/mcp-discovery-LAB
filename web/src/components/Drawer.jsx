import React, { useEffect, useRef, useState } from "react";
import { getRecord } from "../lib/api.js";
import StatusBadge from "./StatusBadge.jsx";
import { Untrusted, pretty } from "./Untrusted.jsx";
import { shortHash } from "../lib/reveal.js";
import { label } from "./Inventory.jsx";

// Detail for one record, fetched from /api/inventory/:id. A non-modal dialog: Escape closes it, focus moves to its
// heading on open and back to the row button on close.
export default function Drawer({ id, onClose }) {
  const [state, setState] = useState({ loading: true });
  const head = useRef(null);

  useEffect(() => {
    let live = true;
    setState({ loading: true });
    getRecord(id).then((d) => live && setState({ record: d.record }), (e) => live && setState({ error: e.message }));
    return () => { live = false; };
  }, [id]);
  useEffect(() => { head.current?.focus(); }, [id]);

  const r = state.record;
  return (
    <aside className="drawer" role="dialog" aria-labelledby="drawer-title" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="drawer-head">
        <h2 id="drawer-title" tabIndex={-1} ref={head}>{r ? <Untrusted text={r.displayName} plain /> : "Server details"}</h2>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
      {state.loading && <p role="status">Loading record</p>}
      {state.error && <p className="alert" role="alert">Could not load this record: {state.error}</p>}
      {r && (
        <div className="drawer-body">
          <p><StatusBadge status={r.status} /> <span className="muted">{r.confidence} / {r.transport} / {r.location}</span></p>
          <dl className="kv">
            <dt>Sources</dt><dd>{r.sources.map(label).join(", ")}</dd>
            <dt>Endpoint</dt><dd className="mono">{r.endpoint ? <Untrusted text={r.endpoint} plain /> : "none"}</dd>
            {r.process && <><dt>Process</dt><dd className="mono">pid {r.process.pid ?? "?"}: <Untrusted text={r.process.command ?? ""} plain /></dd></>}
            {r.container && <><dt>Container</dt><dd className="mono"><Untrusted text={`${r.container.name ?? ""} (${r.container.service ?? ""})`} plain /></dd></>}
            <dt>Server info</dt><dd className="mono">{r.serverInfo ? <Untrusted text={`${r.serverInfo.name} ${r.serverInfo.version}`} plain /> : "none"}</dd>
            <dt>Protocol</dt><dd>{r.protocolVersion ?? "none"}</dd>
            <dt>Probe</dt><dd>{r.probe.errorCode ? `error: ${r.probe.errorCode}` : r.probe.lastSuccessAt ? `answered in ${r.probe.latencyMs} ms` : "not probed"}</dd>
            <dt>Metadata hash</dt><dd className="mono" title={r.toolMetadataHash || ""}>{shortHash(r.toolMetadataHash)}</dd>
          </dl>
          {r.instructions && <><h3>Instructions from the server</h3><Untrusted block text={r.instructions} /></>}
          <h3>Findings ({r.securityFindings.length})</h3>
          {r.securityFindings.length === 0 ? <p className="muted">No findings.</p> : (
            <ul className="findings">
              {r.securityFindings.map((f, i) => (
                <li key={i}>
                  <span className={`sev sev--${f.severity}`}>{f.severity}</span> <strong>{f.kind}</strong> in <code>{f.tool}.{f.field}</code>
                  <div className="small"><Untrusted text={f.evidence} /></div>
                </li>
              ))}
            </ul>
          )}
          <h3>Tools ({r.tools.length})</h3>
          {r.tools.length === 0 ? <p className="muted">No tools listed.</p> : r.tools.map((t, i) => (
            <section key={i} className="tool" aria-label={`Tool ${t.name}`}>
              <h4 className="mono"><Untrusted text={t.name} plain /></h4>
              <Untrusted block text={t.description} />
              <details>
                <summary>Input schema (shown as text)</summary>
                <Untrusted block plain text={pretty(t.inputSchema)} />
              </details>
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}
