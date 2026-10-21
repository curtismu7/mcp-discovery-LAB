import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, applyNodeChanges } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Story from "./Story.jsx";
import { SOURCE_LABEL } from "../lib/status.js";

// sources -> candidates -> probe -> inventory / findings. Boxes are draggable. Simulate walks five steps, each
// lighting boxes and arrows and saying in words what happened, using the numbers from the last real scan when there is one.
const SOURCES = ["host-process", "listener", "compose-service", "client-config", "remote-url"];
const START = [
  ...SOURCES.map((s, i) => ({ id: s, position: { x: 0, y: i * 95 }, data: { title: SOURCE_LABEL[s], sub: "source", kind: "source" } })),
  { id: "candidates", position: { x: 310, y: 190 }, data: { title: "Candidates", sub: "merged and redacted" } },
  { id: "probe", position: { x: 600, y: 190 }, data: { title: "Probe", sub: "loopback only, tools/list" } },
  { id: "inventory", position: { x: 990, y: 60 }, data: { title: "Inventory", sub: "status, hash, diff" } },
  { id: "findings", position: { x: 990, y: 320 }, data: { title: "Findings", sub: "hidden text, instructions, broad schemas" } },
];
const E = (id, source, target, label) => ({ id, source, target, label });
const EDGES = [
  ...SOURCES.map((s) => E(`e-${s}`, s, "candidates")),
  E("e-cp", "candidates", "probe", "probe"),
  E("e-pi", "probe", "inventory", "answers"),
  E("e-pf", "probe", "findings", "tool check"),
];
const SPEEDS = [["0.5", "0.5x"], ["1", "1x"], ["2", "2x"], ["4", "4x"]];
const BASE_MS = 1700;
const PROBED = new Set(["healthy", "review", "hostile", "degraded", "offline"]);

// Sim steps built from the real scan. Without a scan the captions say so and carry no numbers.
export function buildSteps(records, diff) {
  const has = records && records.length > 0;
  const n = (k) => records.filter((r) => r.sources.includes(k)).length;
  const probed = has ? records.filter((r) => PROBED.has(r.status)) : [];
  const count = (s) => records.filter((r) => r.status === s).length;
  const findings = has ? records.reduce((a, r) => a + r.securityFindings.length, 0) : 0;
  const rug = diff?.changed?.filter((c) => c.possibleRugPull) || [];
  const hint = " (Run a scan to see real numbers.)";
  return [
    { nodes: [...SOURCES, "candidates"], edges: SOURCES.map((s) => `e-${s}`), story: 0,
      text: has ? `Sources: ${SOURCES.map((s) => `${n(s)} ${SOURCE_LABEL[s]}`).join(", ")} (a record can come from more than one).` : `Five sources are read.${hint}` },
    { nodes: ["candidates"], edges: [], story: 1,
      text: has ? `${records.length} candidates after merging. Secret-looking strings are already removed.` : `Findings are merged into candidates and redacted.${hint}` },
    { nodes: ["candidates", "probe"], edges: ["e-cp"], story: 2,
      text: has ? `${probed.length} probed, ${records.length - probed.length} listed but not probed (stdio, remote, or not confirmed as MCP). No tool was called.` : `Loopback endpoints are probed with tools/list only.${hint}` },
    { nodes: ["probe", "findings"], edges: ["e-pf"], story: 3,
      text: has ? `${findings} finding${findings === 1 ? "" : "s"} across ${count("hostile")} hostile and ${count("review")} review server${count("hostile") + count("review") === 1 ? "" : "s"}.` : `Tool metadata is hashed and checked.${hint}` },
    { nodes: ["probe", "inventory"], edges: ["e-pi"], story: 4,
      text: !has ? `Each scan is compared with the previous one.${hint}`
        : rug.length ? `Possible rug-pull: ${rug.length} server's tool metadata hash changed since the previous scan.`
        : diff?.firstScan ? "First scan: this is the baseline. Scan again to see changes."
        : `${diff?.changed?.length ?? 0} changed, ${diff?.new?.length ?? 0} new, ${diff?.gone?.length ?? 0} gone since the previous scan.` },
  ];
}

function Box({ data }) {
  return (
    <div className={`fbox${data.on ? " on" : ""}${data.dim ? " dim" : ""}`}>
      {data.kind !== "source" && <Handle id="l" type="target" position={Position.Left} />}
      <Handle id="r" type="source" position={Position.Right} />
      <strong>{data.title}</strong>
      <span>{data.sub}</span>
      {data.count !== undefined && <em>{data.count}</em>}
    </div>
  );
}
const nodeTypes = { box: Box };

export default function Pipeline({ records, diff, theme }) {
  const [moved, setMoved] = useState(START);
  const [speed, setSpeed] = useState("1");
  const [step, setStep] = useState(-1);
  const [running, setRunning] = useState(false);
  const steps = useMemo(() => buildSteps(records, diff), [records, diff]);

  useEffect(() => {
    if (!running) return undefined;
    if (step >= steps.length - 1) { setRunning(false); return undefined; }
    const t = setTimeout(() => setStep((s) => s + 1), BASE_MS / Number(speed));
    return () => clearTimeout(t);
  }, [running, step, steps.length, speed]);

  const simulate = () => { setStep(0); setRunning(true); };
  const reset = () => { setRunning(false); setStep(-1); setMoved(START); };
  const onNodesChange = useCallback((c) => setMoved((n) => applyNodeChanges(c, n)), []);

  const cur = step >= 0 ? steps[step] : null;
  const counts = useMemo(() => {
    if (!records?.length) return {};
    const c = { candidates: records.length, probe: records.filter((r) => PROBED.has(r.status)).length, inventory: records.length, findings: records.reduce((a, r) => a + r.securityFindings.length, 0) };
    for (const s of SOURCES) c[s] = records.filter((r) => r.sources.includes(s)).length;
    return c;
  }, [records]);
  const nodes = useMemo(() => moved.map((n) => ({
    ...n, type: "box",
    data: { ...n.data, count: counts[n.id], on: !!cur?.nodes.includes(n.id), dim: !!cur && !cur.nodes.includes(n.id) },
  })), [moved, cur, counts]);
  const edges = useMemo(() => EDGES.map((e) => ({
    ...e, animated: !!cur?.edges.includes(e.id), className: cur?.edges.includes(e.id) ? "edge-on" : "", markerEnd: { type: MarkerType.ArrowClosed },
  })), [cur]);

  return (
    <>
      <div className="card controls">
        <label>Speed
          <select value={speed} onChange={(e) => setSpeed(e.target.value)}>
            {SPEEDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        <button type="button" className="btn primary" onClick={simulate} disabled={running}>Simulate</button>
        <button type="button" className="btn" onClick={reset}>Reset diagram</button>
        <span className="muted small">{records?.length ? "Numbers come from the last scan." : "No scan yet, so no numbers."} Drag any box.</span>
      </div>
      <div className="flow-wrap" role="group" aria-label="Discovery pipeline: five sources, candidates, probe, inventory and findings. Boxes can be dragged.">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} colorMode={theme}
          fitView fitViewOptions={{ padding: 0.1 }} nodesConnectable={false} proOptions={{ hideAttribution: true }} minZoom={0.2}>
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <p className="caption" role="status" aria-live="polite" data-testid="caption">
        {cur ? `Step ${step + 1} of ${steps.length}: ${cur.text}` : "Press Simulate to walk the pipeline step by step."}
      </p>
      <Story active={cur ? cur.story : -1} />
    </>
  );
}
