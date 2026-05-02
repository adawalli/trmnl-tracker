const ORDER_NUMBER = process.env.TRMNL_ORDER_NUMBER;
const WEBHOOK_URL = process.env.TRMNL_WEBHOOK_URL;

if (!ORDER_NUMBER) {
  console.error("[poll] TRMNL_ORDER_NUMBER not set");
  process.exit(1);
}

if (!WEBHOOK_URL) {
  console.error("[poll] TRMNL_WEBHOOK_URL not set");
  process.exit(1);
}

async function fetchQueue(orderNumber: string) {
  const pageRes = await fetch("https://trmnl.com/order-tracker");
  const html = await pageRes.text();
  const tokenMatch = html.match(
    /name="authenticity_token"\s+value="([^"]+)"/,
  );
  if (!tokenMatch) throw new Error("Could not find CSRF token on page");

  const params = new URLSearchParams();
  params.append("authenticity_token", tokenMatch[1]);
  params.append("order_trackers[order_number]", orderNumber);

  const res = await fetch("https://trmnl.com/order_trackers", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Cookie: pageRes.headers.get("set-cookie") ?? "",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }

  return (await res.json()) as { queue: number; outstanding_orders: number };
}

async function pushToTrmnl(data: {
  queue: number;
  outstanding_orders: number;
}) {
  const payload = {
    merge_variables: {
      order_number: ORDER_NUMBER,
      queue: data.queue,
      outstanding_orders: data.outstanding_orders,
      updated_at: new Date().toISOString(),
    },
  };

  const res = await fetch(WEBHOOK_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.warn(`[poll] TRMNL webhook HTTP ${res.status}: ${detail}`);
    return;
  }

  console.log("[poll] pushed to TRMNL");
}

try {
  console.log(`[poll] checking order #${ORDER_NUMBER}...`);
  const data = await fetchQueue(ORDER_NUMBER);
  console.log(
    `[poll] queue: ${data.queue} / ${data.outstanding_orders} outstanding`,
  );

  await pushToTrmnl(data);
} catch (err) {
  console.error("[poll] error:", err);
  process.exit(1);
}
