import React from "react";
import { STATUSES } from "../lib/status.js";

export default function StatusBadge({ status }) {
  const s = STATUSES[status] || STATUSES.candidate;
  return (
    <span className={`status status--${s.tone}`} title={s.hint} data-status={status}>
      <span aria-hidden="true" className="glyph">{s.glyph}</span>{String(status)}
    </span>
  );
}
