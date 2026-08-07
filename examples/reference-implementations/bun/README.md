# Bun reference server

Bun is the estate's tier-1 JavaScript runtime (`LANGUAGE-POLICY.adoc` §1: Bun >
Deno > pnpm > npm). This is the preferred entry point for new work.

```bash
bun run example_server.js
```

No install step and no lockfile: the server imports only the shared core at
`../aibdp_middleware.js` and `node:fs`, both of which Bun provides natively.

## Routes

| Path | Behaviour |
|---|---|
| `/` | Ordinary page |
| `/article` | In `training` scope — 430 for a training-purpose agent |
| `/public` | Path exception inside `training` — always allowed |
| `/protected` | Guarded by the `aibdpRequired` wrapper, `purpose: "training"` |
| `/health` | JSON status |
| `/.well-known/aibdp.json` | Serves the manifest as `application/aibdp+json` |

## Checking it works

See the four-request check in `../README.md`. In short: `/article` with
`User-Agent: GPTBot/1.0` must return **430**, and the same path with
`Claude-Web/1.0` must return **200** — the first maps to `training` (conditional,
conditions unmet), the second to `indexing` (allowed).

If `/article` returns 200 for GPTBot, the usual cause is that
`policies.training.scope` in `example-aibdp.json` lists paths that do not match
the routes this server actually serves. The middleware fails open, so this is
silent.

## Porting notes

The shared core uses no runtime globals. To add another runtime, copy this file
and replace the final line:

```js
Bun.serve({ port: 5000, fetch: handler });   // Bun
Deno.serve({ port: 5000 }, handler);         // Deno
```

Page helpers must be *functions*, not module-level constants — a `Response` body
is single-use, so returning a shared `Response` object serves the first request
and then throws on every one after it.
