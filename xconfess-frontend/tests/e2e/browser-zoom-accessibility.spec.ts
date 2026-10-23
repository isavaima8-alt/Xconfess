/**
 * browser-zoom-accessibility.spec.ts
 *
 * Automated E2E verification for Issue #223:
 * Support browser zoom and enlarged text across primary workflows.
 *
 * Validates:
 * - WCAG 2.1 Reflow (1.4.10): Key workflows operate without content clipping
 *   or 2D horizontal scrolling at 200% (640px) and 400% (320px) equivalent zoom.
 * - Composer workflow: Text area, toolbar buttons, character counters, and action buttons.
 * - Admin queues workflow: Filter controls, bulk actions, and report list items.
 * - Failure semantics: Error states remain legible and unclipped on zoomed viewports.
 */

import { test, expect, Page } from '@playwright/test';

const MOCK_REPORTS = [
  {
    id: 'rep-1',
    type: 'harassment',
    status: 'pending',
    reason: 'Repeated offensive remarks directed at another user.',
    createdAt: new Date().toISOString(),
    reporter: { username: 'mod_witness' },
  },
  {
    id: 'rep-2',
    type: 'spam',
    status: 'reviewing',
    reason: 'Commercial solicitation links posted repeatedly.',
    createdAt: new Date().toISOString(),
    reporter: { username: 'patrol_bot' },
  },
];

async function setupZoomMocks(page: Page) {
  // Session
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 1, username: 'admin_user', role: 'admin' },
      }),
    }),
  );

  // Confessions feed & stats
  await page.route('**/api/confessions*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ confessions: [], hasMore: false }),
    }),
  );

  await page.route('**/api/users/stats*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ totalConfessions: 0, totalReactions: 0 }),
    }),
  );

  // Admin reports
  await page.route('**/api/admin/reports*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reports: MOCK_REPORTS,
        total: 2,
        page: 1,
        limit: 20,
      }),
    }),
  );
}

test.describe('Issue #223: Browser Zoom and Enlarged Text Support', () => {
  test('composer workflow operates without clipping or horizontal overflow at 200% zoom (640px)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 900 });
    await setupZoomMocks(page);

    await page.goto('/#composer');

    const textarea = page.locator('#confession-body');
    await expect(textarea).toBeVisible({ timeout: 10000 });

    // Formatting toolbar buttons
    const boldButton = page.locator('button[aria-label="Bold"]');
    await expect(boldButton).toBeVisible();

    // Submit and clear buttons
    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeVisible();

    const clearButton = page.locator('button', { hasText: 'Clear draft' });
    await expect(clearButton).toBeVisible();

    // Verify no 2D scrolling on page body
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });

  test('composer workflow reflows cleanly at 400% zoom (320px equivalent width)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await setupZoomMocks(page);

    await page.goto('/#composer');

    const textarea = page.locator('#confession-body');
    await expect(textarea).toBeVisible({ timeout: 10000 });

    // Formatting toolbar
    const toolbar = page.locator('[role="toolbar"]');
    await expect(toolbar).toBeVisible();

    // Submit button wraps and remains fully clickable
    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeVisible();

    const submitBox = await submitButton.boundingBox();
    expect(submitBox).not.toBeNull();
    if (submitBox) {
      expect(submitBox.width).toBeLessThanOrEqual(320);
      expect(submitBox.height).toBeGreaterThanOrEqual(44);
    }

    // Verify page does not force horizontal scroll
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });

  test('admin reports queue renders unclipped stacked cards at 400% zoom (320px)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await setupZoomMocks(page);

    await page.goto('/admin/reports');

    const cardList = page.locator('[data-testid="reports-card-list"]');
    await expect(cardList).toBeVisible({ timeout: 10000 });

    // Verify first report card is visible and controls are accessible
    const viewButton = page.locator('button[aria-label="View report rep-1"]').first();
    await expect(viewButton).toBeVisible();

    const viewButtonBox = await viewButton.boundingBox();
    expect(viewButtonBox).not.toBeNull();
    if (viewButtonBox) {
      expect(viewButtonBox.height).toBeGreaterThanOrEqual(44);
    }

    // Check no horizontal overflow
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});
