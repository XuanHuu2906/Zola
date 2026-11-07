import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';

// Sample real composited backgrounds because axe cannot resolve glass/gradients.
// This is a text contrast check, not a complete WCAG conformance audit.
export async function sampleTextContrast(page: Page) {
  const samples = await page.evaluate(() => {
    const results: { text: string; color: number[]; opacity: number; required: number; points: number[][] }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, el = node.parentElement;
      if (!el || !/[\p{L}\p{N}]/u.test(node.textContent || '') || el.closest('script, style, svg, .brand-logo, .za-mark')) continue;
      const css = getComputedStyle(el);
      if (css.visibility !== 'visible') continue;
      const color = css.color.match(/[\d.]+/g)?.map(Number);
      if (!color || color.length < 3) continue;
      let opacity = color[3] ?? 1;
      for (let parent: Element | null = el; parent; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity);
      if (opacity < .01) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      const points: number[][] = [];
      for (const rect of range.getClientRects()) {
        const y = Math.floor(rect.y + rect.height / 2);
        for (let x = Math.ceil(rect.x + 2); x < rect.right - 1; x += 6) {
          if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) continue;
          const top = document.elementFromPoint(x, y);
          if (top && (top === el || el.contains(top))) points.push([x, y]);
        }
      }
      if (points.length) results.push({ text: node.textContent!.trim().slice(0, 80), color, opacity,
        required: parseFloat(css.fontSize) >= 24 || (parseFloat(css.fontSize) >= 18.66 && Number(css.fontWeight) >= 700) ? 3 : 4.5, points });
    }
    return results;
  });
  const style = await page.addStyleTag({ content: '* { -webkit-text-fill-color: transparent !important; text-shadow: none !important; }' });
  let png: PNG;
  try { png = PNG.sync.read(await page.screenshot({ scale: 'css' })); }
  finally { await style.evaluate(el => (el as Element).remove()); }
  const luminance = (rgb: number[]) => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  return samples.map(({ text, color, opacity, required, points }) => {
    const ratios = points.map(([x, y]) => {
      const index = (y * png.width + x) * 4;
      const bg = Array.from(png.data.subarray(index, index + 3));
      const fg = color.slice(0, 3).map((v, i) => v * opacity + bg[i] * (1 - opacity));
      const a = luminance(fg), b = luminance(bg);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
    return { text, minimumRatio: Math.round(Math.min(...ratios) * 100) / 100, required, sampleCount: points.length };
  });
}
