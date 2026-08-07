#!/usr/bin/env bun
// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Jonathan D.A. Jewell (metadatastician) <jonathan@metadatastician.art>
//
// check-drafts.ts — structural gate over the Internet-Drafts in drafts/.
//
// Every check here corresponds to a defect that was actually present in this
// tree before extraction. This is a regression gate, not a style checker.
//
// It deliberately does NOT replace xml2rfc. Full rendering validation needs
// either xml2rfc (Python, which the estate language policy denies) or the
// author-tools.ietf.org API (a network dependency inside a gate). That decision
// is open — see .machine_readable/descriptiles/STATE.a2ml blockers. What this
// gate does check is everything that can be checked without it, including the
// exact failures that got past every previous review.
//
// Exit 0 — all checks pass.  Exit 1 — at least one failed.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const DRAFTS = "drafts";
const failures: string[] = [];
const notes: string[] = [];

function fail(check: string, detail: string) {
  failures.push(`${check}: ${detail}`);
}

// ── single-source ──────────────────────────────────────────────────────────
// The 430 draft previously existed twice, at the root and under drafts/, with
// materially different normative text (category std vs info, different author
// organisation, different Link relation). See ADR-0005.
const rootDrafts = readdirSync(".").filter(
  (f) => f.startsWith("draft-") && f.endsWith(".xml"),
);
if (rootDrafts.length) {
  fail("single-source", `draft XML at repository root: ${rootDrafts.join(", ")}. drafts/ is the single source — see docs/decisions/0005-canonical-draft-source.adoc`);
}

if (!existsSync(DRAFTS)) {
  fail("single-source", "drafts/ does not exist");
  console.error("FAIL\n  " + failures.join("\n  "));
  process.exit(1);
}

const files = readdirSync(DRAFTS).filter((f) => f.endsWith(".xml"));
if (files.length === 0) fail("single-source", "drafts/ contains no .xml files");

const byBase = new Map<string, string[]>();
for (const f of files) {
  const base = basename(f).replace(/-\d+\.xml$/, "");
  byBase.set(base, [...(byBase.get(base) ?? []), f]);
}
for (const [base, fs] of byBase) {
  if (fs.length > 1) fail("single-source", `${fs.length} copies share base name "${base}": ${fs.join(", ")}`);
}

// ── per-draft structural checks ────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);

for (const f of files) {
  const p = join(DRAFTS, f);
  const xml = readFileSync(p, "utf-8");
  const at = (c: string, d: string) => fail(c, `${f}: ${d}`);

  // well-formedness — Bun ships no XML parser, so use a minimal check that
  // still catches truncation and unbalanced tags of the kinds seen here.
  const opens = [...xml.matchAll(/<([a-zA-Z][\w-]*)(\s[^>]*?)?(?<!\/)>/g)].map((m) => m[1]);
  const closes = [...xml.matchAll(/<\/([a-zA-Z][\w-]*)>/g)].map((m) => m[1]);
  for (const tag of new Set([...opens, ...closes])) {
    const o = opens.filter((t) => t === tag).length;
    const c = closes.filter((t) => t === tag).length;
    if (o !== c) at("well-formed", `<${tag}> opened ${o}x, closed ${c}x`);
  }

  // RFC-XML v3 required metadata. draft-jewell-aibdp-00 shipped without
  // seriesInfo, submissionType or expiresDate while declaring version="3".
  if (!/\bversion="3"/.test(xml)) at("rfcxml-v3", 'missing version="3" on <rfc>');
  for (const attr of ["category", "docName", "ipr", "submissionType", "expiresDate"]) {
    if (!new RegExp(`\\b${attr}="`).test(xml)) at("rfcxml-v3", `missing ${attr}= on <rfc>`);
  }
  if (!/<seriesInfo\b/.test(xml)) at("rfcxml-v3", "missing <seriesInfo> — the datatracker requires it");
  if (!/<date\b/.test(xml)) at("rfcxml-v3", "missing <date>");
  if (!/<author\b/.test(xml)) at("rfcxml-v3", "missing <author>");

  // v2 constructs. The AIBDP draft was v2 throughout while claiming v3, and its
  // <list> elements were siblings of <t> — invalid in v2 as well, so the file
  // validated under no schema at all. This check stops that regressing.
  if (/<section\b[^>]*\btitle=/.test(xml)) at("no-v2", '<section title="..."> is RFC-XML v2; use a <name> child');
  if (/<list\b/.test(xml)) at("no-v2", "<list> is RFC-XML v2; use <ul>/<ol>/<dl>");
  if (/\bhangText=/.test(xml)) at("no-v2", "hangText= is RFC-XML v2; use <dl><dt>/<dd>");
  if (/<references\b[^>]*\btitle=/.test(xml)) at("no-v2", '<references title="..."> is v2; use a <name> child');
  if (/<!DOCTYPE\s+rfc/.test(xml)) at("no-v2", "rfc2629 DOCTYPE is v2; remove it");
  if (/xmlns="http:\/\/www\.rfc-editor\.org\/rfcmarkup"/.test(xml)) {
    at("no-v2", "bogus default namespace; RFC-XML v3 declares only the XInclude namespace");
  }

  // expiry — an expired draft presented as current is precisely the failure
  // this repository exists to name. Red here is the gate working.
  const exp = xml.match(/expiresDate="(\d{4}-\d{2}-\d{2})"/)?.[1];
  if (exp && exp < today) at("draft-expiry", `expired ${exp} (today ${today}) — publish a revision`);
  else if (exp) notes.push(`${f}: expires ${exp}`);
}

// ── report ────────────────────────────────────────────────────────────────
if (notes.length) console.log(notes.map((n) => `  note: ${n}`).join("\n"));
if (failures.length) {
  console.error(`\nFAIL — ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`PASS — ${files.length} draft(s) checked, no structural problems`);
