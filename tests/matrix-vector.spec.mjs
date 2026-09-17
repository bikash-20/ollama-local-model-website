// End-to-end coverage for matrix and vector math rendering.
//
// The bug this guards: a model that emits a bare-line matrix or a vector
// arrow command without `$...$` wrappers used to render as raw text. The
// math pipeline now:
//   - Recognizes all matrix environments (matrix/pmatrix/bmatrix/Bmatrix/
//     vmatrix/Vmatrix/smallmatrix) via TEX_CMD.
//   - Recognizes long vector arrows (overrightarrow/overleftarrow/Overrightarrow/
//     Overleftarrow).
//   - Wraps pure-math lines in `$...$`.
//   - Stashes multi-line `$$ ... $$` blocks with the U+E000 marker so the
//     HTML5 parser doesn't strip them.
//
// These tests drive the production `renderFinalMarkdown` pipeline (the same
// one that runs when an assistant bubble finalizes) and assert that KaTeX
// produced `.katex` / `.katex-display` nodes for each shape.

import { test, expect } from '@playwright/test';

async function renderInBubble(page, rawText) {
  // Stub Ollama so the page doesn't try to actually chat — we're driving
  // the rendering pipeline by hand.
  await page.route('**/api/tags', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"off"}' })
  );
  await page.goto('/');
  // Wait for the production finalizer to be available — it references
  // marked and the math stash helpers, all of which are loaded with the
  // main inline script.
  await page.waitForFunction(() => typeof window.renderFinalMarkdown === 'function', null, { timeout: 5_000 });

  // Drive the exact production code path: renderFinalMarkdown attaches a
  // bubble to the DOM, splices the U+E000 math placeholders back into
  // `$$ ... $$` text, and then runs renderMathInElement over the result.
  const html = await page.evaluate((src) => {
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    document.body.appendChild(bubble);
    try {
      renderFinalMarkdown(bubble, src);
      // give KaTeX's deferred auto-render a tick to land if needed
      return bubble.innerHTML;
    } finally {
      bubble.remove();
    }
  }, rawText);

  return html;
}

test.describe('matrix and vector math rendering', () => {
  test('bare-line pmatrix renders as a KaTeX node', async ({ page }) => {
    const html = await renderInBubble(page, '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}');
    expect(html).toMatch(/<span class="katex"/);
    expect(html).toMatch(/pmatrix/);
  });

  test('bare-line bmatrix renders as a KaTeX node', async ({ page }) => {
    const html = await renderInBubble(page, '\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}');
    expect(html).toMatch(/<span class="katex"/);
    expect(html).toMatch(/bmatrix/);
  });

  test('bare-line Bmatrix (curly braces) renders as a KaTeX node', async ({ page }) => {
    const html = await renderInBubble(page, '\\begin{Bmatrix} 1 & 2 \\\\ 3 & 4 \\end{Bmatrix}');
    expect(html).toMatch(/<span class="katex"/);
    expect(html).toMatch(/Bmatrix/);
  });

  test('bare-line vmatrix (single-bar determinant) renders as a KaTeX node', async ({ page }) => {
    const html = await renderInBubble(page, '\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix} = ad - bc');
    expect(html).toMatch(/<span class="katex"/);
    expect(html).toMatch(/vmatrix/);
  });

  test('bare-line Vmatrix (double-bar norm) renders as a KaTeX node', async ({ page }) => {
    const html = await renderInBubble(page, '\\begin{Vmatrix} 1 \\\\ 2 \\\\ 3 \\end{Vmatrix}');
    expect(html).toMatch(/<span class="katex"/);
    expect(html).toMatch(/Vmatrix/);
  });

  test('bare-line smallmatrix renders as a KaTeX node', async ({ page }) => {
    const html = await renderInBubble(page, '\\begin{smallmatrix} a & b \\\\ c & d \\end{smallmatrix}');
    expect(html).toMatch(/<span class="katex"/);
    expect(html).toMatch(/smallmatrix/);
  });

  test('overrightarrow{v} on a pure-math line renders as a KaTeX node', async ({ page }) => {
    const html = await renderInBubble(page, '\\overrightarrow{v} = (1, 0, 0)');
    expect(html).toMatch(/<span class="katex"/);
    // KaTeX renders overrightarrow as → in the visible output.
    expect(html).toMatch(/overrightarrow|→/);
  });

  test('multi-line $$ ... $$ block round-trips through innerHTML', async ({ page }) => {
    // The user-reported two-formula bug. The HTML5 parser must NOT strip our
    // U+E000 marker, the stash must be restored to a real display-math block,
    // and KaTeX must render both blocks (no MATHSTASH leakage in the bubble).
    const html = await renderInBubble(page,
      'First formula:\n\n$$\n\\tan\\theta = \\left| \\frac{m_2 - m_1}{1 + m_1m_2} \\right|\n$$\n\nSecond formula:\n\n$$\n\\tan\\theta = \\left| \\frac{2\\sqrt{h^2 - ab}}{a + b} \\right|\n$$'
    );
    const displayBlocks = html.match(/class="katex-display"/g) || [];
    expect(displayBlocks.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toMatch(/MATHSTASH/);
    expect(html).not.toMatch(//); // raw U+E000
  });
});
