# TRMNL Order Queue Tracker

Displays your TRMNL order queue position on a TRMNL e-ink device via a private plugin.

The maintainer-hosted instance lives at `https://trmnl.bytefit.io/order-queue`; you can fork the repo and deploy your own to wherever you like. See [ROADMAP.md](./ROADMAP.md) for the bigger picture.

## How it works

1. TRMNL's private plugin polls a secured Cloudflare Worker on a schedule.
2. The Worker proxies the public TRMNL order tracker, handling the two-step CSRF flow that TRMNL's built-in polling can't do natively.
3. The Worker returns JSON merge variables that feed a Liquid template on the device.

## Order tracker API

The public order tracker at `trmnl.com/order-tracker` is a Rails app. Getting queue data requires two HTTP calls:

```bash
# 1. GET the page to obtain a CSRF token + session cookie
TOKEN=$(curl -sc /tmp/trmnl-cookies https://trmnl.com/order-tracker 2>/dev/null \
  | rg -o 'name="authenticity_token" value="([^"]*)"' -r '$1' | head -1)

# 2. POST with token + cookie to get JSON
curl -sb /tmp/trmnl-cookies https://trmnl.com/order_trackers \
  -H 'Accept: application/json' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "authenticity_token=${TOKEN}&order_trackers%5Border_number%5D=12345"
```

Response:

```json
{"queue": 6303, "outstanding_orders": 7525}
```

- `queue` - your position in line
- `outstanding_orders` - total orders ahead of fulfillment

The `authenticity_token` is a Rails CSRF token embedded in the HTML as a hidden form field. It's ephemeral and paired with the session cookie - both must come from the same GET request. This is why TRMNL's polling config (static URL + headers + body) can't call the endpoint directly.

## Cloudflare Worker

Source: `src/worker.ts`. Handles the CSRF dance and returns clean JSON merge variables.

**Endpoint shape**:
- Method: `POST`
- Required header: `x-trmnl-token: <shared secret>`
- Body: JSON with a numeric `order_number`
- Response shape:

```json
{
  "order_number": "12345",
  "queue": 6303,
  "outstanding_orders": 7530,
  "updated_at": "2026-05-01T00:56:24.258Z"
}
```

**Config** (`wrangler.jsonc`):
- Custom domain route on the deploying account's zone
- `workers_dev` disabled so the Worker is exposed only through the custom domain
- `TRMNL_POLL_TOKEN` declared under `secrets.required`

**Secret upload** - generate a long random token (e.g. `openssl rand -hex 32`), store it somewhere outside this repo, and upload via:

```bash
npx wrangler secret put TRMNL_POLL_TOKEN
# paste the token at the prompt, or pipe from a file:
# npx wrangler secret put TRMNL_POLL_TOKEN < /path/to/token-file
```

For local development, create an untracked `.dev.vars`:

```bash
TRMNL_POLL_TOKEN=YOUR_SHARED_SECRET
```

**Local dev**:

```bash
bun install
npx wrangler dev
# then:
curl http://localhost:8787/order-queue \
  -H 'x-trmnl-token: YOUR_SHARED_SECRET' \
  -H 'content-type: application/json' \
  -d '{"order_number":"12345"}'
```

**Deploy**:

```bash
npx wrangler deploy
```

## TRMNL private plugin

- **Strategy**: Polling
- **Polling URL**: your deployed Worker URL (e.g. `https://your-subdomain.your-domain.tld/order-queue`)
- **HTTP Method**: POST
- **Refresh rate**: Every 15 mins
- **Polling headers** (query-string format on the plugin settings page, not JSON):

```
x-trmnl-token=YOUR_SHARED_SECRET&content-type=application/json
```

- **Polling body**:

```json
{
  "order_number": "{{ order_number }}"
}
```

- **Order number field** (form builder): the numeric order number from your TRMNL order confirmation email.

## Liquid template

`trmnl/markup.liquid` is the device display template. Paste it into the plugin's Markup tab. Shows queue position, total outstanding orders, percent through the queue, and a progress bar.

`trmnl/form-builder.yaml` defines the plugin's settings metadata. Paste it into the form builder field on the plugin settings page.

**Local preview**:

```bash
bun run preview:trmnl
# open http://localhost:3937
```

## Setup for your own deployment

1. Fork the repo and clone your fork.
2. `bun install`.
3. **Cloudflare**: pick a custom domain you control on Cloudflare, edit `wrangler.jsonc`'s `routes[0].pattern` to match your domain, and `npx wrangler deploy`.
4. **Token**: generate a random shared secret (`openssl rand -hex 32`) and upload it to your Worker (`npx wrangler secret put TRMNL_POLL_TOKEN`).
5. **TRMNL plugin**: in your TRMNL account, create a private plugin with the polling config above. Paste your token into the polling headers and your Worker URL into the polling URL field.
6. **Markup + form builder**: paste `trmnl/markup.liquid` into the plugin's Markup tab and `trmnl/form-builder.yaml` into the form builder field.
7. **Hardening** (recommended, optional): add the Cloudflare protections described below.

## Cloudflare hardening

The maintainer-hosted Worker sits behind a layered defense at the Cloudflare edge:

- A WAF custom rule blocks any request to `/order-queue` that's missing the expected auth header (so random scanners and `GET /` bots never reach the Worker).
- A second WAF rule allowlists only the ASN(s) that TRMNL is known to poll from, blocking everything else at the edge.
- A rate-limit rule caps requests per IP per minute and keys on the path so a single source can't burn through Worker invocations.
- Bot Fight Mode is **off** on the zone (see below for why).

The Worker itself validates the token value as a final layer. Specific rule expressions are deliberately omitted from this README; deploy with whatever expressions and thresholds suit your zone.

### Bot Fight Mode (must stay off)

Cloudflare Bot Fight Mode (Security → Settings → Bot fight mode) presents a JS-based managed challenge to non-residential ASNs. TRMNL polls from datacenter IPs, so every poll gets challenged before it reaches the WAF or the Worker. TRMNL's HTTP client can't solve the challenge, records empty `merge_variables`, and the device renders `NaN%`.

If the device starts showing blank values or `NaN%`, first thing to check is whether Bot Fight Mode got re-enabled. Diagnostic signature, in order of decisiveness:

1. **Cloudflare → Security → Events** filtered by your Worker's host shows `Managed Challenge` rows from datacenter ASNs at the polling timestamps.
2. **`npx wrangler tail`** during a manual TRMNL Force Refresh shows zero requests reaching the Worker, while a curl from your laptop returns `200` (residential ISP isn't challenged - Bot Fight Mode keys on ASN reputation).
3. **TRMNL plugin debug logs** show `Processed merge_variables for polling URL` within ~125ms of `Processing polling URL` - too fast for the Worker's CSRF dance against `trmnl.com` (which takes 500ms+). That gap means the request was never made; TRMNL got a non-2xx and silently recorded empty merge_variables.

The custom WAF rule plus the Worker's token check do the actual security work. Bot Fight Mode adds nothing for an API endpoint that's already gated by a shared secret, and it false-positives any legitimate datacenter caller. Keep it off.

## Multi-user / OAuth

The current design is single-user (one shared `TRMNL_POLL_TOKEN`). The plan to support multiple users is to switch the Worker into an OAuth 2.0 server (Authorization Code flow + JWT access tokens + KV-backed refresh tokens) and have TRMNL's private plugin OAuth toggle handle the client side. See [ROADMAP.md](./ROADMAP.md#next-multi-user-via-oauth) for details.

## Capacity

At TRMNL's 15-minute polling cadence, each user generates 96 polls/day. The Cloudflare Workers free tier is 100,000 requests/day, so a single shared deployment maxes out at roughly 1,040 active users. Workers Paid ($5/mo, 10M req/mo) lifts that to roughly 104,000 users. If you're forking this for personal use you'll never approach the free tier. If you're hosting for many users, plan accordingly.
