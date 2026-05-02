# Roadmap

Where this project is, where it's going, and how you can fit it to your own setup.

## Now: single-user, static token

The plugin is built around one user (the maintainer's order). One Cloudflare Worker, one shared `TRMNL_POLL_TOKEN`, one TRMNL plugin instance. If you want it for yourself today, fork the repo, deploy your own Worker to your own Cloudflare account, and configure your TRMNL private plugin to point at it. The whole setup is in [`README.md`](./README.md#setup-for-your-own-deployment).

## Next: multi-user via OAuth

Single-user with a shared static token doesn't scale - every additional user shares the same secret with no way to revoke a single one. The plan is to make the Worker its own OAuth 2.0 server using the Authorization Code flow:

- `GET  /oauth/authorize` and `POST /oauth/token` issue per-user JWT access tokens and refresh tokens (refresh tokens stored in Cloudflare KV so they can be revoked).
- `POST /order-queue` switches from `x-trmnl-token` to `Authorization: Bearer <jwt>` and reads the order number from the JWT claims.
- TRMNL's private plugin OAuth toggle handles the client side - paste a `client_id` and `client_secret`, complete the consent once, and TRMNL polls with `Authorization: Bearer {{ oauth_access_token }}`.

This is a prerequisite for the marketplace listing below.

## Later: TRMNL marketplace listing

Once the OAuth path is solid and the UX is polished, the goal is to submit this through TRMNL's plugin marketplace so users can install it from the store rather than self-hosting a Worker. End users would click "Install", connect their TRMNL account through OAuth, type their order number, and start seeing queue position on their device.

## Ongoing: capacity, observability

- **Free-tier ceiling.** TRMNL polls at a 15-minute cadence, which works out to 96 polls/user/day. Cloudflare Workers' free tier is 100,000 requests/day, so the maintainer-hosted Worker tops out at roughly 1,040 active users. If marketplace adoption climbs toward that ceiling, the plan is to upgrade to Workers Paid ($5/mo, 10 million requests/mo, ≈ 104,000 users) or encourage adopters to self-host.
- **Diagnostic playbook.** The `README.md` "Bot Fight Mode" section captures the failure mode that's bitten this project once and is most likely to bite it again - silent polling failure caused by Cloudflare challenging Hetzner-origin requests.
- **Reliability.** No SLA, no on-call. If the maintainer-hosted Worker goes down, the device shows stale values until the next successful poll. Self-host if uptime matters to you.

## Not on the roadmap

- Mobile apps, web dashboards, or any UI other than the Liquid template.
- Deeper integration with `trmnl.com` beyond the public order tracker page.
- Other order-tracking targets - this is specifically about TRMNL device delivery.

## Contributing

Issues and PRs welcome, especially for:

- Liquid template polish (alternate layouts, half/quad views).
- Help getting the OAuth migration over the line.
- Documentation improvements - if your fork ran into a snag the README didn't cover, a PR fixing it helps the next person.

Avoid contributing changes that bake in deployment-specific assumptions (a particular domain, a particular Cloudflare account ID, a particular order number).
