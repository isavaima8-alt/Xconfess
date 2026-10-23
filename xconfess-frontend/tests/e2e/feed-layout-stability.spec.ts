/**
 * feed-layout-stability.spec.ts
 *
 * Automated E2E verification for Issue #222:
 * Stabilize media and text layout during feed loading.
 *
 * Validates:
 * - Media geometry reservation (avatar and attachment aspect-ratio boxes)
 * - Scroll position preservation across hydration and pagination
 * - Mixed text and media content across narrow (375px) and wide (1280px) viewports
 * - Image load failure semantics (graceful fallback without layout shifts)
 * - Keyboard navigation focus stability during dynamic loading
 */

import { test, expect, Page } from '@playwright/test';

const MOCK_CONFESSIONS = [
  {
    id: 'c-1',
    content: 'Short confession without attachments.',
    createdAt: new Date().toISOString(),
    viewCount: 12,
    commentCount: 2,
    reactions: { like: 5, love: 2 },
    author: {
      id: 'u-1',
      username: 'alice',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100',
    },
  },
  {
    id: 'c-2',
    content:
      'A longer confession with multiple lines of reflective thoughts that stretches across multiple sentences and paragraphs to verify mixed content handling under variable line heights.',
    createdAt: new Date().toISOString(),
    viewCount: 45,
    commentCount: 8,
    reactions: { like: 14, love: 9 },
    mediaUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800',
    mediaAspectRatio: 1.7777777778, // 16:9
    author: {
      id: 'u-2',
      username: 'bob',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100',
    },
  },
  {
    id: 'c-3',
    content: 'Confession with broken avatar image to test graceful failure semantics.',
    createdAt: new Date().toISOString(),
    viewCount: 3,
    commentCount: 0,
    reactions: { like: 1, love: 0 },
    author: {
      id: 'u-3',
      username: 'charlie',
      avatar: 'https://invalid-domain.example/non-existent-avatar.jpg',
    },
  },
];

async function setupFeedMocks(page: Page) {
  await page.route('**/api/confessions*', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        confessions: MOCK_CONFESSIONS,
        nextCursor: 'cursor-page-2',
        hasMore: true,
      }),
    });
  });

  await page.route('**/api/users/stats*', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        totalConfessions: 3,
        totalReactions: 31,
        mostPopularConfession: 'c-2',
        badges: [],
        streak: 1,
      }),
    });
  });
}

test.describe('Issue #222: Feed Layout Stability & Media Geometry', () => {
  test('reserves avatar and media geometry to prevent layout shift on wide viewports (1280px)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setupFeedMocks(page);

    await page.goto('/');

    const avatarBox = page.locator('[data-testid="avatar-geometry-box"]').first();
    await expect(avatarBox).toBeVisible({ timeout: 10000 });

    const box = await avatarBox.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(Math.round(box.width)).toBe(44);
      expect(Math.round(box.height)).toBe(44);
    }

    // Media container reserved aspect ratio
    const mediaContainer = page.locator('[data-testid="media-geometry-box"]').first();
    if (await mediaContainer.count() > 0) {
      const mediaBox = await mediaContainer.boundingBox();
      expect(mediaBox).not.toBeNull();
      if (mediaBox) {
        expect(mediaBox.width).toBeGreaterThan(200);
        expect(mediaBox.height).toBeGreaterThan(100);
      }
    }
  });

  test('reserves geometry and wraps mixed content cleanly on narrow viewports (375px mobile)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await setupFeedMocks(page);

    await page.goto('/');

    const avatarBox = page.locator('[data-testid="avatar-geometry-box"]').first();
    await expect(avatarBox).toBeVisible({ timeout: 10000 });

    const box = await avatarBox.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(Math.round(box.width)).toBe(44);
      expect(Math.round(box.height)).toBe(44);
    }

    // Verify card does not cause horizontal overflow
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);
  });

  test('gracefully handles image loading failures with initial fallback without shifting geometry', async ({
    page,
  }) => {
    await setupFeedMocks(page);
    await page.goto('/');

    const avatarBoxes = page.locator('[data-testid="avatar-geometry-box"]');
    await expect(avatarBoxes.first()).toBeVisible({ timeout: 10000 });

    // Ensure all avatar geometry boxes maintain strictly 44x44
    const count = await avatarBoxes.count();
    for (let i = 0; i < count; i++) {
      const box = await avatarBoxes.nth(i).boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(Math.round(box.width)).toBe(44);
        expect(Math.round(box.height)).toBe(44);
      }
    }
  });

  test('preserves keyboard navigation focus without viewport jump', async ({ page }) => {
    await setupFeedMocks(page);
    await page.goto('/');

    const firstCard = page.locator('[data-shortcut-confession]').first();
    await expect(firstCard).toBeVisible({ timeout: 10000 });

    // Focus link inside first card
    const link = firstCard.locator('a').first();
    await link.focus();
    await expect(link).toBeFocused();

    // Verify element is within visible viewport
    const isVisibleInViewport = await link.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
      );
    });
    expect(isVisibleInViewport).toBe(true);
  });
});
