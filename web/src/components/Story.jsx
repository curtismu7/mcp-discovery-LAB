import React from "react";

// What each step proves, in presenter words. Every claim here is something the server does (see docs/architecture.md).
export const STORY = [
  { title: "1. Find", proves: "Five sources are read: processes, listeners, Compose services, client configs and remote URLs. In demo mode they are fixtures, so nothing on this machine is read." },
  { title: "2. Merge", proves: "Findings become candidates. A stdio process that owns a listener folds into it, and secret-looking strings are removed before anything is probed." },
  { title: "3. Probe", proves: "Only loopback endpoints are asked, with server/discover, initialize and tools/list. No tool is ever called and no credential is sent." },
  { title: "4. Check", proves: "Each server's tool metadata is hashed and checked for hidden characters, instruction-like text and broad schemas. That decides the status." },
  { title: "5. Compare", proves: "Each scan is compared with the last. The same server with a different metadata hash is a possible rug-pull: the tools changed after they were first seen." },
];

export default function Story({ active = -1 }) {
  return (
    <section className="story" aria-label="What each step proves">
      <ol>
        {STORY.map((s, i) => (
          <li key={s.title} className={i === active ? "now" : ""} aria-current={i === active ? "step" : undefined}>
            <strong>{s.title}</strong>
            <span>{s.proves}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
