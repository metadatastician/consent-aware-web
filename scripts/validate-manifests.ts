#!/usr/bin/env bun
// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Jonathan D.A. Jewell (metadatastician) <jonathan@metadatastician.art>
//
// validate-manifests.ts — validate AIBDP manifests against the shipped schema.
//
// Dependency-free by design. Pulling ajv in would create a bun.lock, and the
// estate governance gate currently fails builds that carry one (see
// standards/.github/workflows/governance-reusable.yml — a live contradiction
// with LANGUAGE-POLICY.adoc §1, which makes Bun tier 1). A validator we own is
// also a validator that cannot silently stop validating.
//
// Implements the JSON Schema draft-2020-12 subset that
// schemas/aibdp-schema-v0.2.json actually uses: type, required, properties,
// additionalProperties, minProperties, enum, const, oneOf, items, $ref into
// $defs. `format` is parsed and ignored, exactly as ajv does without ajv-formats.
//
// Usage: bun run scripts/validate-manifests.ts <schema> <instance>...

import { readFileSync } from "node:fs";

type Json = any;
const [, , schemaPath, ...targets] = process.argv;
if (!schemaPath || targets.length === 0) {
  console.error("usage: validate-manifests.ts <schema.json> <instance.json>...");
  process.exit(2);
}

const schema: Json = JSON.parse(readFileSync(schemaPath, "utf-8"));

function resolve(ref: string): Json {
  if (!ref.startsWith("#/")) throw new Error(`unsupported $ref: ${ref}`);
  let node: Json = schema;
  for (const seg of ref.slice(2).split("/")) {
    node = node[seg.replace(/~1/g, "/").replace(/~0/g, "~")];
    if (node === undefined) throw new Error(`unresolvable $ref: ${ref}`);
  }
  return node;
}

const typeOf = (v: Json) =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number"
    ? (Number.isInteger(v) ? "integer" : "number") : typeof v;

function validate(data: Json, sch: Json, path: string, errs: string[]): void {
  if (sch === true || sch === undefined) return;
  if (sch === false) { errs.push(`${path}: schema forbids any value`); return; }
  if (sch.$ref) return validate(data, resolve(sch.$ref), path, errs);

  if (sch.type) {
    const want = Array.isArray(sch.type) ? sch.type : [sch.type];
    const got = typeOf(data);
    const ok = want.includes(got) || (got === "integer" && want.includes("number"));
    if (!ok) { errs.push(`${path}: expected ${want.join("|")}, got ${got}`); return; }
  }
  if (sch.const !== undefined && JSON.stringify(data) !== JSON.stringify(sch.const)) {
    errs.push(`${path}: must equal ${JSON.stringify(sch.const)}`);
  }
  if (sch.enum && !sch.enum.some((e: Json) => JSON.stringify(e) === JSON.stringify(data))) {
    errs.push(`${path}: ${JSON.stringify(data)} not one of ${JSON.stringify(sch.enum)}`);
  }
  if (sch.oneOf) {
    const passing = sch.oneOf.filter((s: Json) => { const e: string[] = []; validate(data, s, path, e); return e.length === 0; });
    if (passing.length !== 1) errs.push(`${path}: matched ${passing.length} of oneOf branches, expected exactly 1`);
  }

  if (typeOf(data) === "object") {
    for (const r of sch.required ?? []) {
      if (!(r in data)) errs.push(`${path || "<root>"}: must have required property '${r}'`);
    }
    if (sch.minProperties !== undefined && Object.keys(data).length < sch.minProperties) {
      errs.push(`${path || "<root>"}: needs at least ${sch.minProperties} propert(ies)`);
    }
    for (const [k, v] of Object.entries(data)) {
      const sub = sch.properties?.[k];
      if (sub !== undefined) validate(v, sub, `${path}/${k}`, errs);
      else if (sch.additionalProperties !== undefined) {
        if (sch.additionalProperties === false) errs.push(`${path}/${k}: additional property not permitted`);
        else validate(v, sch.additionalProperties, `${path}/${k}`, errs);
      }
    }
  }

  if (typeOf(data) === "array" && sch.items) {
    data.forEach((v: Json, i: number) => validate(v, sch.items, `${path}/${i}`, errs));
  }
}

let bad = 0;
for (const t of targets) {
  const errs: string[] = [];
  try {
    validate(JSON.parse(readFileSync(t, "utf-8")), schema, "", errs);
  } catch (e) {
    errs.push(`could not read or parse: ${(e as Error).message}`);
  }
  if (errs.length === 0) console.log(`  VALID   ${t}`);
  else {
    bad++;
    console.error(`  INVALID ${t}`);
    for (const e of errs) console.error(`     ${e}`);
  }
}
if (bad) { console.error(`\nFAIL — ${bad} invalid manifest(s)`); process.exit(1); }
console.log(`PASS — ${targets.length} manifest(s) valid against ${schemaPath}`);
