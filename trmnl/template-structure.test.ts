import { describe, expect, test } from "bun:test";

const viewTemplates = [
  { file: "trmnl/markup.liquid", hasProgress: true },
  { file: "trmnl/markup_half_horizontal.liquid", hasProgress: true },
  { file: "trmnl/markup_half_vertical.liquid", hasProgress: true },
  { file: "trmnl/markup_quadrant.liquid", hasProgress: false },
] as const;

const count = (source: string, pattern: RegExp): number => source.match(pattern)?.length ?? 0;

describe("TRMNL view template structure", () => {
  test("each supported view has one layout and one sibling title bar", async () => {
    for (const view of viewTemplates) {
      const source = await Bun.file(view.file).text();

      expect(count(source, /<div\s+class="layout(?:\s|")/g), view.file).toBe(1);
      expect(count(source, /<div\s+class="title_bar">/g), view.file).toBe(1);
    }
  });

  test("progress views use progress-bar as the component root", async () => {
    for (const view of viewTemplates) {
      const source = await Bun.file(view.file).text();

      expect(source, view.file).not.toMatch(/<div\s+class="progress(?:\s|")/);
      expect(count(source, /<div\s+class="progress-bar(?:\s|")/g), view.file).toBe(view.hasProgress ? 1 : 0);
    }
  });

  test("each supported view uses TRMNL X responsive classes", async () => {
    for (const view of viewTemplates) {
      const source = await Bun.file(view.file).text();

      expect(source, view.file).toContain("lg:");
    }
  });
});

describe("TRMNL preview harness", () => {
  test("keeps host layout classes separate from TRMNL framework classes", async () => {
    const source = await Bun.file("scripts/trmnl-preview.ts").text();

    expect(source).not.toMatch(/\.grid\s*\{/);
    expect(source).not.toMatch(/\.card(?:-label)?\s*\{/);
    expect(source).not.toContain('class="screen view');
    expect(source).toContain('class="preview-grid"');
    expect(source).toContain('class="preview-card"');
  });

  test("previews TRMNL OG and TRMNL X publishing targets", async () => {
    const source = await Bun.file("scripts/trmnl-preview.ts").text();

    expect(source).toContain("TRMNL OG");
    expect(source).toContain("TRMNL X Landscape");
    expect(source).toContain("TRMNL X Portrait");
    expect(source).toContain("screen--md");
    expect(source).toContain("screen--lg");
    expect(source).toContain("screen--portrait");
    expect(source).toContain("screen--4bit");
  });
});
