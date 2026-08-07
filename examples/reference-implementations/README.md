# Reference implementations

A single runtime-neutral middleware core, with one thin server entry point per runtime.

```
aibdp_middleware.js      shared core — standard Web APIs plus node:fs. No runtime globals.
bun/example_server.js    Bun.serve   — estate tier 1 (LANGUAGE-POLICY.adoc §1)
deno/example_server.js   Deno.serve  — estate tier 2, grandfathered
```

The core is deliberately free of `Bun.*` and `Deno.*`. Handlers use the standard
`(Request) => Response` shape, so the enforcement logic is written once and the
per-runtime files only differ in how they bind a port.

## Run it

```bash
cd bun  && bun run example_server.js                              # tier 1
cd deno && deno run --allow-read --allow-net example_server.js    # tier 2
```

## Verify it actually enforces

A server that prints "enforcement: ENABLED" has not demonstrated anything. These
four requests distinguish a working deployment from an inert one:

```bash
curl -o /dev/null -w '%{http_code}\n' http://localhost:5000/                                        # 200 — human
curl -o /dev/null -w '%{http_code}\n' http://localhost:5000/article -H 'User-Agent: GPTBot/1.0'     # 430 — training refused in scope
curl -o /dev/null -w '%{http_code}\n' http://localhost:5000/public  -H 'User-Agent: GPTBot/1.0'     # 200 — path exception
curl -o /dev/null -w '%{http_code}\n' http://localhost:5000/article -H 'User-Agent: Claude-Web/1.0' # 200 — indexing allowed
```

The middleware **fails open**: any error loading or parsing the manifest returns
`null` and the request proceeds. That is the right production behaviour — a
malformed manifest must not take a site down — but it means misconfiguration is
silent. If a policy's `scope` paths do not match your real routes, you get 200s
and no warning. Run the four requests above after any manifest change.

## What maps to what

`extractAiPurpose` derives a purpose from `AI-Purpose`, else from the User-Agent:
`GPTBot` and `Google-Extended` → `training`; `Claude-Web` and `Googlebot` →
`indexing`; otherwise `unknown`. A purpose with no matching key under `policies`
is not enforced, so `unknown` traffic always passes.

Policy resolution is `policies[purpose]` → `scope` check → `exceptions` check.
`refused` returns 430 immediately; `conditional` returns 430 unless the request
carries `AI-Consent-Reviewed` and `AI-Consent-Conditions`.

## Licence

`MIT OR GPL-3.0-or-later`, per the IETF external-standards carve-out recorded in
the estate licensing policy. See `LICENSE` at the repository root.
