import React from "react";
import StatusBadge from "./StatusBadge.jsx";
import { Untrusted } from "./Untrusted.jsx";
import { shortHash } from "../lib/reveal.js";

function Item({ rec }) {
  return <li><Untrusted text={rec.displayName} plain /> <StatusBadge status={rec.status} /></li>;
}

function Changed({ c }) {
  const hash = c.changes.find((x) => x.field === "toolMetadataHash");
  const others = c.changes.filter((x) => x.field !== "toolMetadataHash");
  return (
    <li className={c.possibleRugPull ? "rug" : ""} data-testid={c.possibleRugPull ? "rugpull" : "changed"}>
      <div>
        {c.possibleRugPull && <strong className="rug-flag"><span aria-hidden="true">! </span>POSSIBLE RUG-PULL</strong>}{" "}
        <Untrusted text={c.displayName} plain /> <StatusBadge status={c.status} />
      </div>
      {c.possibleRugPull && c.note && <p className="small">{c.note}.</p>}
      {others.map((x) => <p key={x.field} className="small">{x.field}: <code>{String(x.from ?? "none")}</code> to <code>{String(x.to ?? "none")}</code></p>)}
      {hash && (
        <dl className="hashes mono small">
          <dt>Metadata hash before</dt><dd title={hash.from}>{shortHash(hash.from)}</dd>
          <dt>Metadata hash after</dt><dd title={hash.to}>{shortHash(hash.to)}</dd>
        </dl>
      )}
      {c.toolChanges && (
        <p className="small">
          Tools changed: {c.toolChanges.changed.map((n, i) => <code key={i}><Untrusted text={n} plain /> </code>)}
          {c.toolChanges.added.length > 0 && <>added: {c.toolChanges.added.map((n, i) => <code key={i}><Untrusted text={n} plain /> </code>)}</>}
          {c.toolChanges.removed.length > 0 && <>removed: {c.toolChanges.removed.map((n, i) => <code key={i}><Untrusted text={n} plain /> </code>)}</>}
        </p>
      )}
    </li>
  );
}

export default function DiffPanel({ diff }) {
  return (
    <section className="card" aria-labelledby="diff-title">
      <h2 id="diff-title">Scan diff</h2>
      {!diff ? <p className="muted">No scan yet. Scan twice to see what changed.</p> : (
        <>
          <p className="muted">
            {diff.firstScan ? "First scan: this is the baseline, so everything is new. Scan again to compare." : `${diff.new.length} new, ${diff.changed.length} changed, ${diff.gone.length} gone, ${diff.unchanged} unchanged.`}
          </p>
          <div className="cols">
            <div><h3>New ({diff.new.length})</h3>{diff.new.length ? <ul className="plain">{diff.new.map((r) => <Item key={r.id} rec={r} />)}</ul> : <p className="muted small">none</p>}</div>
            <div><h3>Changed ({diff.changed.length})</h3>{diff.changed.length ? <ul className="plain">{diff.changed.map((c) => <Changed key={c.id} c={c} />)}</ul> : <p className="muted small">none</p>}</div>
            <div><h3>Gone ({diff.gone.length})</h3>{diff.gone.length ? <ul className="plain">{diff.gone.map((r) => <Item key={r.id} rec={r} />)}</ul> : <p className="muted small">none</p>}</div>
          </div>
        </>
      )}
    </section>
  );
}
