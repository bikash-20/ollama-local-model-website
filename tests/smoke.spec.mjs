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

  test('custom model dropdown: opens, groups by provider, type-to-filter, selects', async ({ page }) => {
    // Stub Ollama /api/tags as offline so loadModels() falls through to
    // the catalog path. Then poke the page with a mocked FreeLLMAPI
    // /v1/models response (intercepted) — once a model list is in
    // state.models, the picker should render in the "grouped" mode
    // (≥9 entries). We simulate by intercepting /v1/models and then
    // programmatically toggling the backend to freellmapi. This keeps
    // the test fast and deterministic — no actual second server needed.
    await page.route('**/api/tags', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"models":[]}' })
    );
    // Stub the FreeLLMAPI router so the page can fetch a model list
    // without us standing one up. Match any URL ending in /v1/models.
    await page.route(/\/v1\/models(\?|$)/, (route) =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'gemini-3-flash-preview',   owned_by: 'google',   supportsVision: true,  context_length: 1000000 },
            { id: 'gemini-2.5-pro',           owned_by: 'google',   supportsVision: true,  context_length: 2000000 },
            { id: 'gpt-4o',                   owned_by: 'openai',   supportsVision: true,  context_length: 128000 },
            { id: 'gpt-oss-120b',             owned_by: 'openai',   supportsVision: false, context_length: 32000 },
            { id: 'claude-3.5-sonnet',        owned_by: 'anthropic', supportsVision: true, context_length: 200000 },
            { id: 'mistral-medium-3.5',       owned_by: 'mistral',  supportsVision: true,  context_length: 128000 },
            { id: 'llama-3.3-70b',            owned_by: 'meta',     supportsVision: false, context_length: 128000 },
            { id: 'deepseek-v3',              owned_by: 'deepseek', supportsVision: false, context_length: 64000 },
            { id: 'qwen2.5-72b',              owned_by: 'qwen',     supportsVision: false, context_length: 32000 },
            // "Hidden" provider — should be filtered out client-side.
            { id: 'cohere-command-r-plus',    owned_by: 'cohere',   supportsVision: false, context_length: 128000 },
            // The router itself — should be excluded by id.
            { id: 'FreeLLMAPI',               owned_by: 'freellmapi' },
          ],
        }),
      })
    );
    // Also stub the chat endpoint so the UI doesn't try to actually chat.
    await page.route('**/api/chat', (route) => route.fulfill({ status: 200, body: '' }));

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Switch to FreeLLMAPI via the prefs UI. Easiest path: drive localStorage
    // then reload — same effect as user clicking through the modal.
    // Note: backend lives in nocta_state_v1 (state.backend), not in
    // nocta_settings_v1. URL/key live in settings (read by loadFreellmapiModels).
    // Use the same origin as the page (127.0.0.1:8765 — Playwright's static
    // server) so the same-origin check inside loadFreellmapiModels passes;
    // otherwise the diagnostic bails before fetch and the route mock can't
    // intercept the request.
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('nocta_state_v1') || '{}');
      state.backend = 'freellmapi';
      localStorage.setItem('nocta_state_v1', JSON.stringify(state));
      const settings = JSON.parse(localStorage.getItem('nocta_settings_v1') || '{}');
      settings.freellmapiUrl = 'http://127.0.0.1:8765/v1';
      settings.freellmapiKey = 'test-key-for-dropdown';
      localStorage.setItem('nocta_settings_v1', JSON.stringify(settings));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Trigger label should match the active model's display name.
    const trigger = page.locator('#modelSelectBtn');
    await expect(trigger).toBeVisible();

    // Wait for the live /v1/models fetch to land — the trigger label
    // will update from "select a model" to one of the mocked model
    // names. (Until that fetch resolves, the popup renders the 3-entry
    // static catalog fallback.)
    await expect(trigger).toContainText(/gemini|gpt|claude|mistral|llama|deepseek|qwen/i, { timeout: 5_000 });

    await trigger.click();

    // Popup is visible; the search input only renders when list ≥9.
    const popup = page.locator('#modelPopup');
    await expect(popup).toBeVisible();
    await expect(page.locator('#modelSearch')).toBeVisible();

    // Co-grouped provider headers visible (Google, OpenAI, Anthropic, Mistral, Meta, DeepSeek, Qwen).
    // Hidden-provider models (cohere, freellmapi) must not appear.
    await expect(popup.locator('.model-group-label', { hasText: 'Google' })).toBeVisible();
    await expect(popup.locator('.model-row', { hasText: 'cohere-command-r-plus' })).toHaveCount(0);
    await expect(popup.locator('.model-row', { hasText: /^FreeLLMAPI$/ })).toHaveCount(0);

    // Vision badge present on at least one row, absent on a vision-less one.
    await expect(popup.locator('.model-row .vision-badge').first()).toBeVisible();
    await expect(popup.locator('.model-row[data-value="gpt-oss-120b"] .vision-badge')).toHaveCount(0);

    // Type-to-filter: "mistral" should narrow the list to one row.
    await page.locator('#modelSearch').fill('mistral');
    await expect(popup.locator('.model-row:visible')).toHaveCount(1);
    await expect(popup.locator('.model-row:visible').first()).toHaveAttribute('data-value', 'mistral-medium-3.5');

    // Empty-state shown when nothing matches.
    await page.locator('#modelSearch').fill('zzzz-no-match-zzzz');
    await expect(popup.locator('.model-row:visible')).toHaveCount(0);
    await expect(popup.locator('#modelPopupEmpty')).toBeVisible();

    // Clear filter, click a row, verify selection lands in the trigger label.
    await page.locator('#modelSearch').fill('');
    await popup.locator('.model-row[data-value="claude-3.5-sonnet"]').click();
    await expect(popup).toBeHidden();
    await expect(trigger).toContainText(/claude.*3\.5.*sonnet/i);
    await expect(page.locator('#modelSelect')).toHaveValue('claude-3.5-sonnet');

    // Round-trip through localStorage — selection is persisted.
    const persisted = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('nocta_state_v1') || '{}');
      return s.activeModel || null;
    });
    expect(persisted).toBe('claude-3.5-sonnet');
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
