// One place for status meaning. Every status has a word and a glyph; colour is never the only signal.
export const STATUSES = {
  healthy: { glyph: "✓", tone: "ok", hint: "Probed; tool metadata has no findings." },
  review: { glyph: "?", tone: "hold", hint: "Probed; medium findings only, such as a broad schema." },
  hostile: { glyph: "!", tone: "deny", hint: "Probed; hidden characters or instruction-like text in tool metadata." },
  degraded: { glyph: "~", tone: "hold", hint: "Answered but unusable: auth required, redirect, too large, or method not found." },
  offline: { glyph: "×", tone: "mute", hint: "No answer: timeout or connection failure." },
  candidate: { glyph: "·", tone: "info", hint: "Found but not probed: stdio, remote, skipped or not allowed." },
};
export const STATUS_ORDER = ["hostile", "review", "degraded", "offline", "healthy", "candidate"];
export const SOURCE_LABEL = {
  "host-process": "processes",
  listener: "listeners",
  "compose-service": "compose",
  "client-config": "client configs",
  "remote-url": "remote URLs",
};
