import * as jose from "jose";

interface Env {
  CLERK_DOMAIN: string;
}

class BadRequestError extends Error {}

let jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
let jwksDomain: string | null = null;

function getJWKS(domain: string) {
  if (jwks && jwksDomain === domain) return jwks;
  jwks = jose.createRemoteJWKSet(new URL(`${domain}/.well-known/jwks.json`));
  jwksDomain = domain;
  return jwks;
}

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ") || !env.CLERK_DOMAIN) return false;

  try {
    await jose.jwtVerify(auth.slice(7), getJWKS(env.CLERK_DOMAIN), {
      issuer: env.CLERK_DOMAIN,
      algorithms: ["RS256"],
    });
    return true;
  } catch (err) {
    console.error("jwt verify failed", err);
    return false;
  }
}

async function fetchQueue(orderNumber: string): Promise<{ queue: number; outstanding_orders: number }> {
  const pageRes = await fetch("https://trmnl.com/order-tracker");
  const html = await pageRes.text();

  const tokenMatch = html.match(/name="authenticity_token"\s+value="([^"]+)"/);
  if (!tokenMatch) throw new Error("CSRF token not found");

  const cookie = pageRes.headers.get("set-cookie") ?? "";

  const params = new URLSearchParams();
  params.append("authenticity_token", tokenMatch[1]);
  params.append("order_trackers[order_number]", orderNumber);

  const res = await fetch("https://trmnl.com/order_trackers", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "Cookie": cookie,
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Order tracker returned ${res.status}: ${detail}`);
  }

  return res.json();
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

async function readOrderNumber(request: Request): Promise<string> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new BadRequestError("Request body must be valid JSON");
  }

  if (!body || typeof body !== "object" || !("order_number" in body)) {
    throw new BadRequestError("order_number is required");
  }

  const orderNumber = String((body as { order_number: unknown }).order_number).trim();
  if (!/^\d+$/.test(orderNumber)) {
    throw new BadRequestError("order_number must contain only digits");
  }

  return orderNumber;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/order-queue") {
      return jsonError("Not found", 404);
    }

    if (request.method !== "POST") {
      return jsonError("Method not allowed", 405);
    }

    if (!(await isAuthorized(request, env))) {
      return jsonError("Unauthorized", 401);
    }

    try {
      const orderNumber = await readOrderNumber(request);
      const data = await fetchQueue(orderNumber);
      return Response.json({
        order_number: orderNumber,
        queue: data.queue,
        outstanding_orders: data.outstanding_orders,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = err instanceof BadRequestError ? 400 : 502;
      return jsonError(message, status);
    }
  },
};
