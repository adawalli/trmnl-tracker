import { Liquid } from "liquidjs";

const PORT = Number(process.env.PORT ?? 3937);
const MARKUP_PATH = "trmnl/markup.liquid";
const engine = new Liquid();

const previewData = {
  order_number: process.env.TRMNL_ORDER_NUMBER ?? "12345",
  queue: 6303,
  outstanding_orders: 7525,
  updated_at: new Date().toISOString(),
};

const shell = (rendered: string) => `<!DOCTYPE html>
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
    .screen { margin: 0 auto; box-shadow: 0 8px 32px rgba(0,0,0,0.12); }
    .meta-bar { max-width: 800px; margin: 12px auto 0; font-size: 12px; color: #666; display: flex; justify-content: space-between; }
  </style>
</head>
<body class="environment trmnl">
  <div class="screen">
    <div class="view view--full">
      ${rendered}
    </div>
  </div>
  <div class="meta-bar">
    <span>rendered from <code>${MARKUP_PATH}</code></span>
    <span>refresh to re-render</span>
  </div>
</body>
</html>`;

Bun.serve({
  port: PORT,
  async fetch() {
    try {
      const liquidSrc = await Bun.file(MARKUP_PATH).text();
      const rendered = await engine.parseAndRender(liquidSrc, previewData);
      return new Response(shell(rendered), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      return new Response(`<pre>${msg}</pre>`, {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  },
});

console.log(`[trmnl-preview] http://localhost:${PORT}`);
