interface Env {
  TRMNL_POLL_TOKEN: string;
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
    throw new Error("Request body must be valid JSON");
  }

  if (!body || typeof body !== "object" || !("order_number" in body)) {
    throw new Error("order_number is required");
  }

  const orderNumber = String((body as { order_number: unknown }).order_number).trim();
  if (!/^\d+$/.test(orderNumber)) {
    throw new Error("order_number must contain only digits");
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

    if (!env.TRMNL_POLL_TOKEN) {
      return jsonError("TRMNL_POLL_TOKEN not configured", 500);
    }

    if (request.headers.get("x-trmnl-token") !== env.TRMNL_POLL_TOKEN) {
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
      const status = message.startsWith("order_number") || message.includes("valid JSON") ? 400 : 502;
      return jsonError(message, status);
    }
  },
};
