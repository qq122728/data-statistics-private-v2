import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AppPageLoading from "../../src/app/(app)/loading";

describe("application page loading state", () => {
  it("renders an accessible content skeleton without fake business values", () => {
    const html = renderToStaticMarkup(createElement(AppPageLoading));

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("正在加载页面");
    expect((html.match(/data-skeleton=/g) ?? []).length).toBeGreaterThanOrEqual(10);
    expect(html).not.toMatch(/>\s*(?:\$|\d+(?:\.\d+)?%?)\s*</);
  });
});
