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
- Required header: `Authorization: Bearer <clerk-issued JWT>`
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
- `CLERK_DOMAIN` var (public; matches the `iss` claim in JWTs the Worker accepts)

The Worker verifies each request's bearer token against Clerk's JWKS at `${CLERK_DOMAIN}/.well-known/jwks.json` and checks the `iss` claim. There are no Worker secrets; auth is fully delegated to Clerk.

**Local dev**:

```bash
bun install
npx wrangler dev
# obtain a test JWT from Clerk (Sessions in dashboard, or via Clerk Backend API), then:
curl http://localhost:8787/order-queue \
  -H "Authorization: Bearer ${CLERK_JWT}" \
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
- **OAuth**: enable "OAuth Authentication" on the plugin and configure it to point at your Clerk instance (see [Setup for your own deployment](#setup-for-your-own-deployment)). TRMNL handles the authorization-code dance and refresh-token rotation; your Worker just verifies the JWT it polls with.
- **Polling headers** (query-string format on the plugin settings page, not JSON):

```
Authorization=Bearer {{ oauth_access_token }}&content-type=application/json
```

- **Polling body**:

```json
{
  "order_number": "{{ order_number }}"
}
```

- **Order number field** (form builder): the numeric order number from your TRMNL order confirmation email.

## Liquid templates

The TRMNL marketplace requires a markup variant for each layout the plugin supports. There's one Liquid file per variant; paste each into the corresponding tab in the plugin's Markup editor:

| File | TRMNL tab | Dimensions |
|---|---|---|
| `trmnl/markup.liquid` | Full | 800x480 |
| `trmnl/markup_half_horizontal.liquid` | Half horizontal | 800x240 |
| `trmnl/markup_half_vertical.liquid` | Half vertical | 400x480 |
| `trmnl/markup_quadrant.liquid` | Quadrant | 400x240 |
| `trmnl/shared.liquid` | Shared | (prepended to each view; defines the derived metrics) |

All four show the same primary metric: **orders ahead of you** (the actionable countdown to fulfillment), with progressively less context as the layout shrinks. The percent value (`Of queue ahead`) is the share of outstanding orders at-or-ahead of your position; it drops toward 0% as you advance.

`trmnl/form-builder.yaml` defines the plugin's settings metadata. Paste it into the form builder field on the plugin settings page.

**Local preview** renders all four layouts on one page at their actual e-ink dimensions:

```bash
bun run preview:trmnl
# open http://localhost:3937
```

## Setup for your own deployment

1. **Fork + install**: fork the repo, clone your fork, `bun install`.
2. **Clerk**: create a free Clerk application (clerk.com).
   - Enable Google as a Social Connection (Configure → SSO Connections → Google). Clerk's hosted credentials are fine for low volume.
   - Create an OAuth Application (Configure → OAuth Applications → New OAuth App). Set the Callback URL to TRMNL's auto-generated OAuth Redirect URL (visible in the plugin's Configure OAuth dialog). Scopes: `email profile openid`.
   - Note the OAuth App's `client_id`, `client_secret`, and your Clerk instance domain (e.g. `https://my-app.clerk.accounts.dev`).
3. **Cloudflare Worker**: edit `wrangler.jsonc` - set `routes[0].pattern` to a custom domain you control, and `vars.CLERK_DOMAIN` to your Clerk instance domain. Then `npx wrangler deploy`.
4. **TRMNL plugin**: create a private plugin in your TRMNL account with the polling config above.
   - Toggle **Enable OAuth Authentication** on. In the Configure OAuth dialog:
     - Authorization URL: `${CLERK_DOMAIN}/oauth/authorize`
     - Token URL: `${CLERK_DOMAIN}/oauth/token`
     - Client ID / Client Secret: from your Clerk OAuth Application
     - Scopes: `email profile openid`
     - PKCE: enable (defense in depth)
   - Set the polling URL to your Worker, polling headers to `Authorization=Bearer {{ oauth_access_token }}&content-type=application/json`, polling body to `{"order_number":"{{ order_number }}"}`.
   - Click **Connect** - Clerk hosts the Google sign-in + consent screen, then redirects back to TRMNL with a code TRMNL exchanges for tokens.
5. **Markup + form builder**: paste each file in `trmnl/` into its corresponding tab in the plugin's Markup editor (Full, Half horizontal, Half vertical, Quadrant, and Shared per the table above), and paste `trmnl/form-builder.yaml` into the form builder field.
6. **Hardening** (recommended, optional): add the Cloudflare protections described below.

## Cloudflare hardening

The maintainer-hosted Worker sits behind a layered defense at the Cloudflare edge:

- A WAF custom rule blocks any non-POST or any POST to `/order-queue` that's missing an `Authorization` header (so random scanners and `GET /` bots never reach the Worker).
- A second WAF rule allowlists only the ASN(s) that TRMNL is known to poll from, blocking everything else at the edge.
- A rate-limit rule caps requests per source IP keyed on the path so a single source can't burn through Worker invocations.
- Bot Fight Mode is **off** on the zone (see below for why).

The Worker itself verifies the JWT signature against Clerk's JWKS as a final layer. Specific rule expressions are deliberately omitted from this README; deploy with whatever expressions and thresholds suit your zone.

### Bot Fight Mode (must stay off)

Cloudflare Bot Fight Mode (Security → Settings → Bot fight mode) presents a JS-based managed challenge to non-residential ASNs. TRMNL polls from datacenter IPs, so every poll gets challenged before it reaches the WAF or the Worker. TRMNL's HTTP client can't solve the challenge, records empty `merge_variables`, and the device renders `NaN%`.

If the device starts showing blank values or `NaN%`, first thing to check is whether Bot Fight Mode got re-enabled. Diagnostic signature, in order of decisiveness:

1. **Cloudflare → Security → Events** filtered by your Worker's host shows `Managed Challenge` rows from datacenter ASNs at the polling timestamps.
2. **`npx wrangler tail`** during a manual TRMNL Force Refresh shows zero requests reaching the Worker, while a curl from your laptop returns `200` (residential ISP isn't challenged - Bot Fight Mode keys on ASN reputation).
3. **TRMNL plugin debug logs** show `Processed merge_variables for polling URL` within ~125ms of `Processing polling URL` - too fast for the Worker's CSRF dance against `trmnl.com` (which takes 500ms+). That gap means the request was never made; TRMNL got a non-2xx and silently recorded empty merge_variables.

The custom WAF rule plus the Worker's token check do the actual security work. Bot Fight Mode adds nothing for an API endpoint that's already gated by a shared secret, and it false-positives any legitimate datacenter caller. Keep it off.

## Multi-user / OAuth

Authentication is delegated to [Clerk](https://clerk.com) acting as a hosted OAuth 2.0 provider. Clerk runs the sign-in UI, Google IdP integration, consent screen, token issuance, and refresh-token rotation. TRMNL's private-plugin OAuth toggle does the client-side dance. The Worker is a pure resource server: on every poll it verifies the bearer JWT against Clerk's JWKS and checks the `iss` claim. There is no per-user state on the Worker side - the JWT identifies the user and the form-builder's `order_number` field carries their data. See [ROADMAP.md](./ROADMAP.md) for the bigger picture.

## Capacity

At TRMNL's 15-minute polling cadence, each user generates 96 polls/day. The Cloudflare Workers free tier is 100,000 requests/day, so a single shared deployment maxes out at roughly 1,040 active users. Workers Paid ($5/mo, 10M req/mo) lifts that to roughly 104,000 users. If you're forking this for personal use you'll never approach the free tier. If you're hosting for many users, plan accordingly.
