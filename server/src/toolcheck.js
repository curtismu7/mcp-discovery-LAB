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

// Common Cyrillic and Greek letters that look like Latin ones. Applied after NFKC (which already folds fullwidth,
// circled and other compatibility forms) so "ignоre prеvious instructiоns" still matches. Not a full confusables table.
const CONFUSABLES = Object.fromEntries(Object.entries({
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'һ': 'h', 'ԛ': 'q', 'ѵ': 'v',
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'І': 'I', 'Ј': 'J', 'Ѕ': 'S',
  'ο': 'o', 'ν': 'v', 'ι': 'i', 'τ': 't', 'α': 'a', 'ε': 'e', 'κ': 'k', 'ρ': 'p', 'υ': 'u',
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Χ': 'X', 'Υ': 'Y', 'Ζ': 'Z',
  'ı': 'i', 'ɡ': 'g',
}));
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join('')}]`, 'g');
export const foldForMatching = (text) => text.normalize('NFKC').replace(CONFUSABLE_RE, (c) => CONFUSABLES[c]);

const MAX_DEPTH = 32;
const MAX_NODES = 5000;
const TEXT_KEYS = new Set(['description', 'title', '$comment', 'default', 'const', 'example', 'examples', 'enum']);

// Walks an inputSchema. Returns the texts worth checking (property names, titles, descriptions, enum / default /
// example / const strings), every object with additionalProperties:true, and whether the walk gave up (too deep / too big).
function walkSchema(schema) {
  const texts = []; const broad = []; let truncated = false; let nodes = 0;
  const strings = (v, path, depth) => {
    if (typeof v === 'string') { texts.push([path, v]); return; }
    if (!v || typeof v !== 'object') return;
    if (depth > MAX_DEPTH || ++nodes > MAX_NODES) { truncated = true; return; }
    for (const [k, x] of Object.entries(v)) strings(x, `${path}.${k}`, depth + 1);
  };
  const walk = (node, path, depth) => {
    if (!node || typeof node !== 'object') return;
    if (depth > MAX_DEPTH || ++nodes > MAX_NODES) { truncated = true; return; }
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1)); return; }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'additionalProperties' && v === true) broad.push(path);
      if (TEXT_KEYS.has(k)) { strings(v, `${path}.${k}`, depth + 1); continue; }
      if (k === 'properties' && v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [name, sub] of Object.entries(v)) { texts.push([`${path}.properties[name]`, name]); walk(sub, `${path}.properties.${name}`, depth + 2); }
        continue;
      }
      if (v && typeof v === 'object') walk(v, `${path}.${k}`, depth + 1);
    }
  };
  walk(schema, 'inputSchema', 0);
  return { texts, broad, truncated };
}

export function checkTools(tools) {
  const findings = [];
  const add = (tool, field, kind, severity, evidence) => findings.push({ tool: revealText(tool, 128), field: revealText(field, 200), kind, severity, evidence: revealText(evidence, 120) });
  for (const tool of tools || []) {
    const name = String(tool?.name ?? '');
    const s = tool?.inputSchema;
    const schema = s && typeof s === 'object' ? walkSchema(s) : { texts: [], broad: [], truncated: false };
    const texts = [['name', name], ['description', typeof tool?.description === 'string' ? tool.description : ''], ...schema.texts];
    for (const [field, text] of texts) {
      const hidden = text.match(new RegExp(INVISIBLE.source, 'gu'));
      if (hidden) add(name, field, 'invisible-characters', 'high', `${hidden.length} hidden character(s) in: ${text}`);
      const plain = foldForMatching(text.replace(new RegExp(INVISIBLE.source, 'gu'), ''));
      for (const [re, label] of INSTRUCTION_PATTERNS) {
        const m = plain.match(re);
        if (m) { add(name, field, 'hidden-instruction', 'high', `${label}: ${m[0]}`); break; }
      }
    }
    if (schema.truncated) add(name, 'inputSchema', 'too-deep', 'medium', `schema deeper than ${MAX_DEPTH} levels or larger than ${MAX_NODES} nodes: not fully checked`);
    if (!s || typeof s !== 'object') add(name, 'inputSchema', 'broad-schema', 'medium', 'no input schema');
    else if (s.additionalProperties === true) add(name, 'inputSchema', 'broad-schema', 'medium', 'additionalProperties is true');
    else if (s.type === 'object' && !('properties' in s) && s.additionalProperties !== false) add(name, 'inputSchema', 'broad-schema', 'medium', 'object schema with no properties and no additionalProperties:false');
    for (const path of schema.broad) if (path !== 'inputSchema') add(name, path, 'broad-schema', 'medium', 'additionalProperties is true (nested)');
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
