// Nocta smoke tests — three end-to-end checks that catch the most common
// regression classes for a single-file PWA:
//
//   1. The page loads, hydrates, and doesn't throw any console errors.
//   2. When Ollama is unreachable, the persistent offline banner shows up
//      and exposes the "How to start" guidance button.
//   3. Chat history persists across a hard reload (localStorage round-trip).
//
// These tests intentionally avoid mocking the voice server, the service
// worker registration, or KaTeX rendering — those have their own tests or
// are exercised manually. The goal here is *plumbing*: does the app boot,
// does it tolerate Ollama being down, does it remember what the user typed.
//
// Run:  npm test   (after `npm install` and `npx playwright install chromium`)

import { test, expect } from '@playwright/test';

test.describe('Nocta smoke', () => {
  test('boots cleanly and renders the empty state', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto('/');

    // The boot loader is hidden after the first paint; the empty state is
    // the first interactive surface. Either visible is fine — what matters
    // is that *something* app-shaped has rendered.
    await expect(page.locator('#emptyState')).toBeVisible();
    await expect(page.locator('#modelSelect')).toBeAttached();

    // Sidebar footer is always visible — proves the JS bootstrap completed.
    await expect(page.locator('#prefsBtn')).toBeVisible();

    // Filter out benign console noise: the font CDN may 404 on offline CI
    // and KaTeX prints warnings to console.error for malformed inputs that
    // never appear here. Real regressions will surface additional errors.
    const realErrors = consoleErrors.filter(
      (e) => !/fonts\.googleapis\.com|katex/i.test(e)
    );
    expect(realErrors, `unexpected console errors: ${realErrors.join('\n')}`).toEqual([]);
  });

  test('shows the persistent offline banner when Ollama is unreachable', async ({ page }) => {
    // Intercept the /api/tags request that loadModels() fires on boot and
    // fail it. This is the same code path the app uses when Ollama is
    // genuinely down — we don't need to actually take Ollama offline.
    await page.route('**/api/tags', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'simulated offline' }),
    }));

    await page.goto('/');

    // The persistent banner carries the .persistent class (see
    // showPersistentOffline() in index.html). It should expose a retry
    // button and a "How to start" affordance — both are part of the
    // contract this test is verifying.
    const banner = page.locator('#errorBanner.persistent');
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText(/Ollama server not detected/i);
    await expect(page.locator('#retryOllama')).toBeVisible();
    await expect(page.locator('#howToStart')).toBeVisible();
  });

  test('chat history persists across a hard reload', async ({ page }) => {
    // Stub Ollama so the page doesn't try to actually send the message —
    // we only care about localStorage, not whether the server is up.
    await page.route('**/api/tags', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"models":[]}' })
    );
    await page.route('**/api/chat', (route) =>
      route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: '' })
    );

    await page.goto('/');

    // ⌘K / Ctrl+K creates a fresh chat (document keydown handler at the
    // bottom of the inline script). Use a plain shortcut instead of
    // clicking the New Chat button so the test mirrors actual user flow.
    await page.keyboard.press('ControlOrMeta+k');

    // Type into the textarea and send. The send button stays disabled
    // until the textarea has content, so wait for it to enable.
    const input = page.locator('#input');
    await input.fill('hello nocta, remember me');
    await expect(page.locator('#sendBtn')).toBeEnabled();
    await page.locator('#sendBtn').click();

    // The user row should appear with our message text. We don't assert
    // anything about the assistant reply because the stub returns an empty
    // stream and that's fine for what we're testing (persistence).
    await expect(page.locator('.row.user .bubble')).toContainText('hello nocta, remember me');

    // Hard reload — bypass the HTTP cache so we exercise localStorage
    // rather than bfcache. This is the real test: after a fresh load,
    // does the chat come back?
    await page.reload({ waitUntil: 'domcontentloaded' });

    // The sidebar list should still have a chat with our user message in
    // its preview line.
    const chatItem = page.locator('.chat-item');
    await expect(chatItem).toBeVisible();
    await expect(chatItem).toContainText('hello nocta, remember me');

    // And clicking it should reveal the user row in the messages column.
    await chatItem.click();
    await expect(page.locator('.row.user .bubble')).toContainText('hello nocta, remember me');
  });

  test('preferences show backend selector with Ollama selected by default', async ({ page }) => {
    // Phase 1: prefs modal exposes a backend picker (Ollama vs FreeLLMAPI)
    // and Ollama is the default for fresh installs / no saved state.
    // /api/tags 503s so we go straight to the catalog view (no spinners).
    await page.route('**/api/tags', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"off"}' })
    );
    await page.goto('/');
    await page.locator('#prefsBtn').click();

    const picker = page.locator('.backend-picker');
    await expect(picker).toBeVisible();
    // The active pill matches the default backend.
    await expect(picker.locator('.backend-pill.active', { hasText: 'Ollama' })).toBeVisible();
    // The Ollama URL section is shown; the FreeLLMAPI fields are hidden.
    await expect(page.locator('[data-backend-section="ollama"]')).toBeVisible();
    await expect(page.locator('[data-backend-section="freellmapi"]')).toBeHidden();
  });
});
