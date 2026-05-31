import { Liquid } from "liquidjs";

const PORT = Number(process.env.PORT ?? 3937);
const engine = new Liquid();

const SHARED_PATH = "trmnl/shared.liquid";

const VIEWS = [
  { key: "full", path: "trmnl/markup.liquid", label: "Full", w: 800, h: 480 },
  { key: "half_horizontal", path: "trmnl/markup_half_horizontal.liquid", label: "Half horizontal", w: 800, h: 240 },
  { key: "half_vertical", path: "trmnl/markup_half_vertical.liquid", label: "Half vertical", w: 400, h: 480 },
  { key: "quadrant", path: "trmnl/markup_quadrant.liquid", label: "Quadrant", w: 400, h: 240 },
] as const;

const previewData = {
  order_number: process.env.TRMNL_ORDER_NUMBER ?? "12345",
  queue: 6303,
  outstanding_orders: 7525,
  updated_at: new Date().toISOString(),
};

async function renderView(view: (typeof VIEWS)[number], shared: string): Promise<string> {
  try {
    const liquidSrc = await Bun.file(view.path).text();
    const rendered = await engine.parseAndRender(shared + liquidSrc, previewData);
    return `<div class="screen" style="width:${view.w}px;height:${view.h}px;"><div class="view view--${view.key}">${rendered}</div></div>`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `<div class="screen-missing" style="width:${view.w}px;height:${view.h}px;"><pre>${msg}</pre></div>`;
  }
}

const shell = (cards: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>TRMNL Order Queue - Preview</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;350;375;400;450;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="https://trmnl.com/css/latest/plugins.css" />
  <script src="https://trmnl.com/js/latest/plugins.js"></script>
  <style>
    body { margin: 0; padding: 24px; background: #f5f5f5; font-family: Inter, system-ui, sans-serif; }
    h1 { margin: 0 0 16px; font-size: 18px; font-weight: 600; }
    .preview-grid { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
    .preview-card { display: flex; flex-direction: column; gap: 8px; }
    .preview-card-label { font-size: 12px; color: #666; }
    .screen, .screen-missing { box-shadow: 0 8px 32px rgba(0,0,0,0.12); background: #fff; overflow: hidden; }
    .screen-missing { display: flex; align-items: center; justify-content: center; color: #b00; font-size: 12px; padding: 12px; box-sizing: border-box; }
  </style>
</head>
<body class="environment trmnl">
  <h1>TRMNL Order Queue - all layouts</h1>
  <div class="preview-grid">${cards}</div>
</body>
</html>`;

Bun.serve({
  port: PORT,
  async fetch() {
    const shared = await Bun.file(SHARED_PATH).text().catch(() => "");
    const cards = await Promise.all(
      VIEWS.map(async (v) => `<div class="preview-card"><span class="preview-card-label">${v.label} (${v.w}x${v.h})</span>${await renderView(v, shared)}</div>`)
    );
    return new Response(shell(cards.join("")), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
});

console.log(`[trmnl-preview] http://localhost:${PORT}`);
