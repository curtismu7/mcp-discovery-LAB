// Redaction: anything secret-looking is removed before a record is stored or returned.
const SECRET_KEY = /(authorization|cookie|token|secret|passw(?:or)?d|api[-_]?key|client[-_]?secret|signature|credential)/i;
const MARK = '[REDACTED]';

export function redactUrl(value) {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_KEY.test(key)) url.searchParams.delete(key);
    }
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return value;
  }
}

export function redactText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (m) => redactUrl(m))
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${MARK}`)
    .replace(/(--?[\w-]*(?:api[-_]?key|token|secret|passw(?:or)?d)[\w-]*)([=\s]+)(?!\[REDACTED\])("[^"]*"|'[^']*'|[^\s]+)/gi, `$1$2${MARK}`)
    .replace(/\b([A-Za-z0-9_]*(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Za-z0-9_]*)=(?!\[REDACTED\])("[^"]*"|'[^']*'|[^\s]+)/g, `$1=${MARK}`)
    .replace(/\b(?:sk|pk|ghp|gho|xox[bap])[-_][A-Za-z0-9_-]{16,}/g, MARK);
}

function deep(value) {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(deep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deep(v)]));
  return value;
}

export function redactRecord(record = {}) {
  const output = deep(structuredClone(record));
  delete output.headers;
  delete output.environment;
  delete output.env;
  if (output.process) delete output.process.env;
  return output;
}
