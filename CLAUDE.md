# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A TRMNL private plugin that displays your TRMNL order queue position on a TRMNL e-ink device. A Cloudflare Worker proxies the trmnl.com order tracker (which requires a two-step CSRF flow that TRMNL's polling strategy can't handle natively) and returns clean JSON merge variables consumed by a Liquid template.

## Commands

```bash
bun install                  # install deps
bun run dev                  # local Worker dev server (wrangler dev) at localhost:8787
bun run deploy               # deploy Worker to Cloudflare
bun run preview:trmnl        # Liquid template preview at localhost:3937
bun scripts/poll-order-queue.ts  # one-shot: fetch queue + push to TRMNL webhook (needs .env)
```

## Architecture

Two data paths feed the same set of Liquid templates with the same merge variables (`order_number`, `queue`, `outstanding_orders`, `updated_at`):

1. **Polling path** (production) - TRMNL polls `src/worker.ts` (Cloudflare Worker) on a schedule. Authentication is Clerk-issued OAuth Bearer JWTs verified against Clerk's JWKS. The Worker does GET+POST against trmnl.com to handle the CSRF token exchange, then returns JSON. `order_number` arrives in the JSON POST body.

2. **Webhook path** (manual) - `scripts/poll-order-queue.ts` runs locally, does the same CSRF fetch, then POSTs merge variables to the TRMNL webhook API. Requires `TRMNL_ORDER_NUMBER` and `TRMNL_WEBHOOK_URL` from `.env`.

Both paths duplicate the `fetchQueue()` logic (CSRF GET, then POST with token+cookie).

The Liquid templates live under `trmnl/` — one file per TRMNL view layout, plus a shared file:

- `trmnl/markup.liquid` (Full, 800x480)
- `trmnl/markup_half_horizontal.liquid` (Half horizontal, 800x240)
- `trmnl/markup_half_vertical.liquid` (Half vertical, 400x480)
- `trmnl/markup_quadrant.liquid` (Quadrant, 400x240)
- `trmnl/shared.liquid` (defines `orders_ahead`, `orders_behind`, `pct_ahead`; prepended to each view at render time)

Paste each into its matching tab in the TRMNL Markup editor. `scripts/trmnl-preview.ts` renders all four views on one page at native dimensions, prepending `shared.liquid` to mirror TRMNL's render behavior.

`trmnl/form-builder.yaml` defines the plugin's "about" metadata for the TRMNL plugin settings page.

## Environment

- Worker config: `CLERK_DOMAIN` is set in `wrangler.jsonc` vars (public; the OAuth `iss` and JWKS host). `order_number` is provided per-request in the POST body, not in config. No Worker secrets — auth is delegated to Clerk.
- Script config: `.env` with `TRMNL_ORDER_NUMBER` and `TRMNL_WEBHOOK_URL` (see `.env.example`)
- Wrangler auth: OAuth-based (`npx wrangler whoami` to verify)
- Maintainer-only operational details (account ID, plugin UUID, deployed WAF rules, Clerk OAuth Application credentials) live in `MAINTAINER.local.md` (gitignored)
