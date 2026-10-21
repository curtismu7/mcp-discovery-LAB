import React from "react";
import StatusBadge from "./StatusBadge.jsx";
import { Untrusted } from "./Untrusted.jsx";
import { SOURCE_LABEL, STATUS_ORDER } from "../lib/status.js";

export const label = (s) => SOURCE_LABEL[s] || s;

export function SummaryChips({ summary }) {
  if (!summary?.total) return null;
  const by = summary.byStatus || {};
  return (
    <ul className="chips" aria-label="Records by status">
      <li className="muted">{summary.total} records</li>
      {STATUS_ORDER.filter((s) => by[s]).map((s) => <li key={s}><StatusBadge status={s} /> <span className="count">{by[s]}</span></li>)}
    </ul>
  );
}

export default function Inventory({ records, onOpen, openId }) {
  if (!records.length) {
    return <p className="empty card">Inventory is empty. Press <strong>Scan</strong> to discover servers.</p>;
  }
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Discovered servers, scrollable">
      <table className="inv">
        <caption className="sr-only">Discovered MCP servers</caption>
        <thead>
          <tr>
            <th scope="col">Server</th><th scope="col">Status</th><th scope="col" className="opt">Sources</th>
            <th scope="col" className="opt">Confidence</th><th scope="col" className="opt">Transport</th><th scope="col">Tools</th><th scope="col">Findings</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => {
            const high = r.securityFindings.filter((f) => f.severity === "high").length;
            return (
              <tr key={r.id} className={r.id === openId ? "open" : ""} data-testid={`row-${r.id}`}>
                <th scope="row">
                  <button type="button" className="link" onClick={(e) => onOpen(r.id, e.currentTarget)} aria-haspopup="dialog">
                    <Untrusted text={r.displayName} plain /><span className="sr-only"> (open details)</span>
                  </button>
                  {r.endpoint && <div className="small muted mono"><Untrusted text={r.endpoint} plain /></div>}
                </th>
                <td><StatusBadge status={r.status} /></td>
                <td className="opt">{r.sources.map(label).join(", ")}</td>
                <td className="opt">{r.confidence}</td>
                <td className="opt">{r.transport}</td>
                <td>
                  {r.tools.length ? (
                    <ul className="plain mono small">{r.tools.map((t, i) => <li key={i}><Untrusted text={t.name} plain /></li>)}</ul>
                  ) : <span className="muted">none</span>}
                </td>
                <td>
                  {r.securityFindings.length
                    ? <span>{r.securityFindings.length} <span className="muted">({high} high)</span></span>
                    : <span className="muted">none</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
