#!/usr/bin/env bun
// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Jonathan D.A. Jewell (metadatastician) <jonathan@metadatastician.art>
//
// check-claims.ts — every repository-local path a governance document asserts
// must exist on disk.
//
// This is the M4 regression gate. The predecessor of this repository shipped an
// RSR-COMPLIANCE.md asserting PASS for LICENSE.txt, MAINTAINERS.md,
// CHANGELOG.md, flake.nix and a whole .well-known/ tree — none of which were
// present. A compliance document that names files it has not checked is worse
// than no document, because it reads as evidence.
//
// Scope: backtick-quoted paths in the root authority documents. External
// references (other repositories, URLs) are skipped — this checks what the repo
// says about ITSELF.

import { existsSync, readFileSync, readdirSync } from "node:fs";

const DOCS = [
  "README.adoc", "AUDIT.adoc", "AFFIRMATION.adoc", "EXPLAINME.adoc", "RSR-PHILOSOPHY.adoc",
  // The status documents make more path claims than anything else in the tree,
  // and they are exactly the documents that went stale last time: the previous
  // TEST-NEEDS.adoc inventoried Idris2 and Zig trees that had been deleted.
  ...readdirSync("docs/status").filter((f) => f.endsWith(".adoc")).map((f) => `docs/status/${f}`),
];

// Paths owned by other repositories, or illustrative rather than asserted.
const EXTERNAL = [
  /^standards\//,          // hyperpolymath/standards
  /^hyperpolymath\//, /^metadatastician\//,
  /^https?:/, /^git@/, /^mailto:/,
  /^\/\.well-known\//,     // the protocol's path on a CONSUMER's origin, not here
  /^\/(article|public|protected|health)$/, // demo routes
  /^\$/,                   // shell/env expansions
  /^[A-Z_]+$/,             // env var names
];

// Root files whose absence would be a real claim failure.
const ROOT_FILES = new Set([
  "README.adoc", "AUDIT.adoc", "AFFIRMATION.adoc", "EXPLAINME.adoc",
  "GOVERNANCE.adoc", "MAINTAINERS.adoc", "RSR-PHILOSOPHY.adoc", "CHANGELOG.md",
  "LICENSE", "CITATION.cff", "Justfile", "coordination.k9", "CLAUDE.md",
  "0-AI-MANIFEST.a2ml", "sonar-project.properties", "mise.toml",
]);

// A glob is satisfied if anything matches it.
function globSatisfied(pattern: string): boolean {
  const parts = pattern.split("/");
  const i = parts.findIndex((p) => p.includes("*"));
  if (i === -1) return existsSync(pattern);
  const dir = parts.slice(0, i).join("/") || ".";
  if (!existsSync(dir)) return false;
  const rx = new RegExp("^" + parts[i].replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  let hits: string[];
  try { hits = readdirSync(dir).filter((e) => rx.test(e)); } catch { return false; }
  if (i === parts.length - 1) return hits.length > 0;
  return hits.some((h) => globSatisfied([...parts.slice(0, i), h, ...parts.slice(i + 1)].join("/")));
}

let missing = 0;
let checked = 0;

for (const doc of DOCS) {
  if (!existsSync(doc)) continue;
  const text = readFileSync(doc, "utf-8");

  // A document may legitimately NAME a path in order to record that it is gone
  // ("removed at extraction", "dropped and not replaced"). That is the opposite
  // of a claim that it exists, and suppressing it would push the honest
  // documentation of a deletion out of the tree. Lines carrying removal
  // language are therefore exempt.
  //
  // Granularity is the PARAGRAPH, not the line: AsciiDoc wraps prose, so
  // "...referred to `src/interface/ffi/` (Zig) — a seam this project never
  // had." puts the path and the disclaimer on different lines. Not the whole
  // file either — a document about one deletion must not silently excuse an
  // unrelated bad claim elsewhere in it.
  const GONE = /\b(remove[ds]?|delete[ds]?|dropp?ed|withdrawn|no longer|never had|absent|was never|used to|previously|retired)\b/i;
  const live = text.split(/\n\s*\n/).filter((para) => !GONE.test(para)).join("\n\n");

  const claims = new Set(
    [...live.matchAll(/`([A-Za-z0-9_.][A-Za-z0-9_./*-]*)`/g)]
      .map((m) => m[1])
      // Only PATHS are assertions about this repository. A bare filename
      // ("robots.txt", "deno.json") is almost always illustrative prose, so it
      // is not treated as a claim unless it is a known root authority file.
      .filter((p) => p.includes("/") || ROOT_FILES.has(p))
      .filter((p) => !EXTERNAL.some((re) => re.test(p))),
  );

  for (const c of claims) {
    checked++;
    // a trailing / or * means "this directory/glob"; check the directory
    const probe = c.replace(/\/$/, "");
    const ok = probe.includes("*") ? globSatisfied(probe) : existsSync(probe);
    if (probe && !ok) {
      console.error(`  MISSING  ${doc} asserts \`${c}\` — not on disk`);
      missing++;
    }
  }
}

if (missing) {
  console.error(`\nFAIL — ${missing} asserted path(s) do not exist (of ${checked} checked).`);
  console.error("Either create them, or stop claiming them. See scripts/check-claims.ts.");
  process.exit(1);
}
console.log(`PASS — all ${checked} asserted repository paths exist`);
