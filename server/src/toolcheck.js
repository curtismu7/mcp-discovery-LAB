// Self-contained tool-metadata checker. Not a general scanner: a hash of the canonical metadata (to notice change)
// and a few findings (hidden characters, instruction-like text, overly broad schemas). Inputs are untrusted data.
import { createHash } from 'node:crypto';
import { INVISIBLE, revealText } from './sanitize.js';

function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]));
  return v;
}
const sha = (s) => `sha256:${createHash('sha256').update(s).digest('hex')}`;
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// name, description and inputSchema only; object keys sorted so key order alone never changes the hash.
export function canonicalTool(tool) {
  return JSON.stringify(sortDeep({ name: tool?.name ?? '', description: tool?.description ?? '', inputSchema: tool?.inputSchema ?? {} }));
}
export const canonicalTools = (tools) => JSON.stringify([...(tools || [])].map((t) => JSON.parse(canonicalTool(t))).sort(byName));
export const hashTools = (tools) => sha(canonicalTools(tools));

const INSTRUCTION_PATTERNS = [
  [/<\s*(important|system|instructions?)\b/i, 'tag-wrapped instruction'],
  [/ignore\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions?|rules|messages)/i, 'ignore previous instructions'],
  [/do\s+not\s+(tell|mention|reveal|show|inform)\b[^.]{0,40}\b(user|human)/i, 'concealment from the user'],
  [/\b(before|first)\b[^.]{0,60}\b(you\s+must|always|must)\b[^.]{0,60}\b(call|use|read|send|include)/i, 'forced precondition'],
  [/(~\/\.ssh|\.ssh\/|id_rsa|\/etc\/passwd|\.env\b|credentials?\s+file)/i, 'sensitive file reference'],
  [/\b(forward|send|post|exfiltrate|upload)\b[^.]{0,60}\b(conversation|chat|history|secrets?|keys?|tokens?|contents?)\b/i, 'data forwarding instruction'],
  [/\bsystem\s+prompt\b/i, 'system prompt reference'],
];

function* strings(schema, path = 'inputSchema', depth = 0) {
  if (depth > 8 || !schema || typeof schema !== 'object') return;
  for (const [k, v] of Object.entries(schema)) {
    if ((k === 'description' || k === 'title') && typeof v === 'string') yield [`${path}.${k}`, v];
    else if (v && typeof v === 'object') yield* strings(v, `${path}.${k}`, depth + 1);
  }
}

export function checkTools(tools) {
  const findings = [];
  const add = (tool, field, kind, severity, evidence) => findings.push({ tool: revealText(tool, 128), field, kind, severity, evidence: revealText(evidence, 120) });
  for (const tool of tools || []) {
    const name = String(tool?.name ?? '');
    const texts = [['name', name], ['description', typeof tool?.description === 'string' ? tool.description : ''], ...strings(tool?.inputSchema)];
    for (const [field, text] of texts) {
      const hidden = text.match(new RegExp(INVISIBLE.source, 'gu'));
      if (hidden) add(name, field, 'invisible-characters', 'high', `${hidden.length} hidden character(s) in: ${text}`);
      const plain = text.replace(new RegExp(INVISIBLE.source, 'gu'), '');
      for (const [re, label] of INSTRUCTION_PATTERNS) {
        const m = plain.match(re);
        if (m) { add(name, field, 'hidden-instruction', 'high', `${label}: ${m[0]}`); break; }
      }
    }
    const s = tool?.inputSchema;
    if (!s || typeof s !== 'object') add(name, 'inputSchema', 'broad-schema', 'medium', 'no input schema');
    else if (s.additionalProperties === true) add(name, 'inputSchema', 'broad-schema', 'medium', 'additionalProperties is true');
    else if (s.type === 'object' && !('properties' in s) && s.additionalProperties !== false) add(name, 'inputSchema', 'broad-schema', 'medium', 'object schema with no properties and no additionalProperties:false');
  }
  return findings;
}

export function analyzeToolMetadata(tools) {
  const list = Array.isArray(tools) ? tools : [];
  return {
    findings: checkTools(list),
    toolMetadataHash: hashTools(list),
    toolHashes: Object.fromEntries(list.map((t) => [revealText(t?.name ?? '', 128), sha(canonicalTool(t))])),
  };
}
