# Roadmap

Where this project is, where it's going, and how you can fit it to your own setup.

## Now: multi-user via Clerk OAuth

Authentication is delegated to [Clerk](https://clerk.com) acting as a hosted OAuth 2.0 provider:

- Clerk runs the sign-in UI, Google IdP integration, consent screen, token issuance, and refresh-token rotation.
- TRMNL's private-plugin OAuth toggle handles the client side - paste your Clerk OAuth Application's `client_id` and `client_secret`, finish consent once, and TRMNL polls with `Authorization: Bearer {{ oauth_access_token }}`.
- The Worker is a pure resource server: it verifies each JWT against Clerk's JWKS at `${CLERK_DOMAIN}/.well-known/jwks.json` and checks the `iss` claim. No per-user state on the Worker side.

To run this for yourself, fork the repo, create a Clerk app + OAuth Application, deploy the Worker to your Cloudflare account, and point a private TRMNL plugin at it. Full steps are in [`README.md`](./README.md#setup-for-your-own-deployment).

## Next: TRMNL marketplace listing

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
- Marketplace-listing prep (the architectural shift from private-plugin OAuth client to TRMNL Third-Party plugin server).
- Documentation improvements - if your fork ran into a snag the README didn't cover, a PR fixing it helps the next person.

Avoid contributing changes that bake in deployment-specific assumptions (a particular domain, a particular Cloudflare account ID, a particular order number).
