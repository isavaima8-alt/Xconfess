import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock('@/app/components/common/Toast', () => ({
  useGlobalToast: () => mockToast,
}));
jest.mock('@/app/lib/api/admin', () => ({
  adminApi: {
    requestStepUp: jest.fn().mockResolvedValue({
      stepUpToken: 'fresh-step-up-proof',
      expiresIn: 300,
    }),
  },
}));

import AccountSettingsPage from '@/app/(dashboard)/settings/account/page';
import { SETTINGS_DRAFT_STORAGE_KEY } from '@/app/lib/settings/accountSettingsRecovery';
import { adminApi } from '@/app/lib/api/admin';

const serverPrivacy = {
  isDiscoverable: true,
  canReceiveReplies: true,
  showReactions: true,
  dataProcessingConsent: false,
};

const channel = () => ({ inApp: true, email: true, push: true });

const serverNotifications = {
  reactions: channel(),
  comments: channel(),
  mentions: channel(),
  tips: channel(),
  reports: channel(),
  system: channel(),
  enableQuietHours: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
  timezone: null,
};

type RouteHandler = (init?: RequestInit) => Response | Promise<Response>;

let store: Map<string, string>;
let routes: Record<string, RouteHandler>;

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body ?? {}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fail(status: number, message: string): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function echo(init?: RequestInit): Response {
  return ok(JSON.parse(String(init?.body)));
}

function seedDraft(payload: Record<string, unknown>) {
  store.set(SETTINGS_DRAFT_STORAGE_KEY, JSON.stringify(payload));
}

const originalRecoveryEnv = process.env.NEXT_PUBLIC_SETTINGS_RECOVERY_ENABLED;

beforeEach(() => {
  jest.clearAllMocks();
  routes = {};
  store = new Map<string, string>();

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
    },
  });

  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const handler = routes[`${method} ${url}`];
      if (handler) return handler(init);

      if (method === 'GET' && url === '/api/users/privacy-settings') return ok(serverPrivacy);
      if (method === 'GET' && url === '/api/users/notification-preferences') {
        return ok(serverNotifications);
      }
      if (method === 'PATCH' && url === '/api/users/privacy-settings') return echo(init);
      if (method === 'PATCH' && url === '/api/users/notification-preferences') return echo(init);
      if (method === 'GET' && url === '/api/auth/session') return ok({ user: { id: 'u1' } });
      return fail(404, 'Not found');
    },
  ) as unknown as typeof fetch;
});

afterEach(() => {
  if (originalRecoveryEnv === undefined) {
    delete process.env.NEXT_PUBLIC_SETTINGS_RECOVERY_ENABLED;
  } else {
    process.env.NEXT_PUBLIC_SETTINGS_RECOVERY_ENABLED = originalRecoveryEnv;
  }
});

async function renderFlow() {
  render(<AccountSettingsPage />);
  await waitFor(() => {
    expect(screen.getByRole('switch', { name: 'Profile Discovery' })).toBeInTheDocument();
  });
}

async function confirmStepUp(user: ReturnType<typeof userEvent.setup>) {
  const passwordInput = screen.getByLabelText('Account password');
  await user.click(passwordInput);
  await user.type(passwordInput, 'Current!Pass1');
  expect(passwordInput).toHaveValue('Current!Pass1');
  await user.click(screen.getByRole('button', { name: 'Verify' }));
}

describe('AccountSettingsPage recovery flow', () => {
  it('persists each step explicitly, preserves input across back navigation, and finishes cleanly', async () => {
    const user = userEvent.setup();
    await renderFlow();

    expect(within(screen.getByTestId('step-rail-privacy')).getByText('No changes')).toBeInTheDocument();

    const discovery = screen.getByRole('switch', { name: 'Profile Discovery' });
    await user.click(discovery);
    expect(discovery).toHaveAttribute('aria-checked', 'false');
    expect(
      within(screen.getByTestId('step-rail-privacy')).getByText('Unsaved changes'),
    ).toBeInTheDocument();

    // Unsaved input is backed up locally as soon as it changes.
    await waitFor(() => {
      const raw = store.get(SETTINGS_DRAFT_STORAGE_KEY);
      expect(raw).toBeDefined();
      expect(raw).toContain('"isDiscoverable":false');
    });

    // Edit the second step.
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('switch', { name: 'In-App notifications for Reactions' }));

    // Back navigation keeps unsaved input intact.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('switch', { name: 'Profile Discovery' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(
      within(screen.getByTestId('step-rail-privacy')).getByText('Unsaved changes'),
    ).toBeInTheDocument();

    // Save notifications first.
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Save notifications' }));
    await waitFor(() => {
      expect(
        within(screen.getByTestId('step-rail-notifications')).getByText('Saved'),
      ).toBeInTheDocument();
    });
    expect(mockToast.success).toHaveBeenCalledWith('Notifications saved');

    // Save privacy.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Save privacy' }));
    expect(screen.getByRole('dialog', { name: 'Confirm your identity' })).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/users/privacy-settings',
      expect.objectContaining({ method: 'PATCH' }),
    );
    await confirmStepUp(user);
    await waitFor(() => {
      expect(within(screen.getByTestId('step-rail-privacy')).getByText('Saved')).toBeInTheDocument();
    });
    expect(mockToast.success).toHaveBeenCalledWith('Privacy saved');
    expect(adminApi.requestStepUp).toHaveBeenCalledWith({
      password: 'Current!Pass1',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/users/privacy-settings',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'x-step-up-token': 'fresh-step-up-proof',
        }),
      }),
    );

    // Review exposes per-step persistence state and only then allows finishing.
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(within(screen.getByTestId('step-rail-review')).getByText('All saved')).toBeInTheDocument();
    expect(screen.getByTestId('review-privacy')).toHaveTextContent('Saved');
    expect(screen.getByTestId('review-notifications')).toHaveTextContent('Saved');

    const finishButton = screen.getByRole('button', { name: 'Finish' });
    await waitFor(() => expect(finishButton).toBeEnabled());
    await user.click(finishButton);

    expect(screen.getByTestId('settings-complete')).toHaveTextContent('All settings saved.');
    expect(store.has(SETTINGS_DRAFT_STORAGE_KEY)).toBe(false);
  });

  it('restores unsaved input and resume position after an interrupted session', async () => {
    seedDraft({
      version: 1,
      updatedAt: '2026-10-19T10:00:00.000Z',
      activeStep: 'notifications',
      steps: {
        privacy: { ...serverPrivacy, isDiscoverable: false },
      },
    });

    const user = userEvent.setup();
    render(<AccountSettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('switch', { name: 'In-App notifications for Reactions' }),
      ).toBeInTheDocument();
    });

    // Resumed where the flow was interrupted, with a visible recovery notice.
    expect(screen.getByTestId('step-rail-notifications')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('recovered-draft-banner')).toBeInTheDocument();
    expect(screen.getByTestId('step-badge-privacy')).toHaveTextContent('Unsaved changes');
    expect(within(screen.getByTestId('step-rail-privacy')).getByText('Unsaved changes')).toBeInTheDocument();

    // The restored value survives navigation.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('switch', { name: 'Profile Discovery' })).toHaveAttribute(
      'aria-checked',
      'false',
    );

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('recovered-draft-banner')).toBeNull();
  });

  it('marks a failed save with an explicit retry and never retries automatically', async () => {
    const user = userEvent.setup();
    let privacyPatches = 0;
    routes['PATCH /api/users/privacy-settings'] = (init) => {
      privacyPatches += 1;
      if (privacyPatches === 1) return fail(500, 'Server error. Please try again later.');
      return echo(init);
    };

    await renderFlow();
    await user.click(screen.getByRole('switch', { name: 'Profile Discovery' }));
    await user.click(screen.getByRole('button', { name: 'Save privacy' }));
    await confirmStepUp(user);

    await waitFor(() => {
      expect(
        within(screen.getByTestId('step-rail-privacy')).getByText('Failed to save'),
      ).toBeInTheDocument();
    });
    expect(mockToast.error).toHaveBeenCalledWith('Server error. Please try again later.');
    expect(screen.getByTestId('failure-privacy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(privacyPatches).toBe(1);

    // The unsaved input is still backed up locally.
    expect(store.get(SETTINGS_DRAFT_STORAGE_KEY)).toContain('"isDiscoverable":false');

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await confirmStepUp(user);
    await waitFor(() => {
      expect(within(screen.getByTestId('step-rail-privacy')).getByText('Saved')).toBeInTheDocument();
    });
    expect(privacyPatches).toBe(2);
    await waitFor(() => expect(store.has(SETTINGS_DRAFT_STORAGE_KEY)).toBe(false));
  });

  it('blocks saving after session expiry until the session is revalidated', async () => {
    const user = userEvent.setup();
    let privacyPatches = 0;
    let sessionChecks = 0;
    routes['PATCH /api/users/privacy-settings'] = (init) => {
      privacyPatches += 1;
      if (privacyPatches === 1) return fail(401, 'Your session has expired. Please log in again.');
      return echo(init);
    };
    routes['GET /api/auth/session'] = () => {
      sessionChecks += 1;
      if (sessionChecks === 1) return fail(401, 'Unauthenticated');
      return ok({ user: { id: 'u1' } });
    };

    await renderFlow();
    await user.click(screen.getByRole('switch', { name: 'Profile Discovery' }));
    await user.click(screen.getByRole('button', { name: 'Save privacy' }));
    await confirmStepUp(user);

    await waitFor(() => {
      expect(
        within(screen.getByTestId('step-rail-privacy')).getByText('Session expired'),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('session-expired-banner')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save privacy' })).toBeDisabled();
    // Unsaved input is preserved for the re-authenticated retry.
    expect(store.get(SETTINGS_DRAFT_STORAGE_KEY)).toContain('"isDiscoverable":false');
    expect(privacyPatches).toBe(1);

    // A failing revalidation keeps the step locked.
    await user.click(screen.getByRole('button', { name: 'Check session' }));
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'Your session is still expired. Sign in again to continue.',
      );
    });
    expect(
      within(screen.getByTestId('step-rail-privacy')).getByText('Session expired'),
    ).toBeInTheDocument();

    // After sign-in the session revalidates and an explicit retry is allowed.
    await user.click(screen.getByRole('button', { name: 'Check session' }));
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        'Session verified — you can retry saving now.',
      );
    });
    expect(screen.queryByTestId('session-expired-banner')).toBeNull();
    expect(
      within(screen.getByTestId('step-rail-privacy')).getByText('Unsaved changes'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save privacy' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Save privacy' }));
    await confirmStepUp(user);
    await waitFor(() => {
      expect(within(screen.getByTestId('step-rail-privacy')).getByText('Saved')).toBeInTheDocument();
    });
    expect(privacyPatches).toBe(2);
    expect(sessionChecks).toBe(2);
  });

  it('rejects non-retryable failures without offering a retry', async () => {
    const user = userEvent.setup();
    routes['PATCH /api/users/privacy-settings'] = () =>
      fail(403, 'You do not have permission to perform this action.');

    await renderFlow();
    await user.click(screen.getByRole('switch', { name: 'Profile Discovery' }));
    await user.click(screen.getByRole('button', { name: 'Save privacy' }));
    await confirmStepUp(user);

    await waitFor(() => {
      expect(
        within(screen.getByTestId('step-rail-privacy')).getByText('Failed to save'),
      ).toBeInTheDocument();
    });
    expect(mockToast.error).toHaveBeenCalledWith(
      'You do not have permission to perform this action.',
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByTestId('failure-privacy')).toHaveTextContent(/cannot be retried/i);

    // Discarding is the supported escape hatch for rejected changes.
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(within(screen.getByTestId('step-rail-privacy')).getByText('No changes')).toBeInTheDocument();
    expect(screen.queryByTestId('failure-privacy')).toBeNull();
    await waitFor(() => expect(store.has(SETTINGS_DRAFT_STORAGE_KEY)).toBe(false));
  });

  it('ignores a corrupt stored draft without breaking the flow', async () => {
    store.set(SETTINGS_DRAFT_STORAGE_KEY, '{not-json');
    await renderFlow();

    expect(screen.queryByTestId('recovered-draft-banner')).toBeNull();
    expect(screen.getByTestId('step-badge-privacy')).toHaveTextContent('No changes');
    expect(screen.getByRole('switch', { name: 'Profile Discovery' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('never issues concurrent saves for the same step', async () => {
    const user = userEvent.setup();
    let privacyPatches = 0;
    let releasePatch: (() => void) | null = null;
    routes['PATCH /api/users/privacy-settings'] = (init) => {
      privacyPatches += 1;
      return new Promise<Response>((resolve) => {
        releasePatch = () => resolve(echo(init));
      });
    };

    await renderFlow();
    await user.click(screen.getByRole('switch', { name: 'Profile Discovery' }));

    const saveButton = screen.getByRole('button', { name: 'Save privacy' });
    await user.click(saveButton);
    await confirmStepUp(user);

    expect(saveButton).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    await user.click(saveButton);
    expect(privacyPatches).toBe(1);

    await act(async () => {
      releasePatch?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(within(screen.getByTestId('step-rail-privacy')).getByText('Saved')).toBeInTheDocument();
    });
    expect(privacyPatches).toBe(1);
  });

  it('surfaces load failures with an explicit retry', async () => {
    const user = userEvent.setup();
    let privacyGets = 0;
    routes['GET /api/users/privacy-settings'] = () => {
      privacyGets += 1;
      if (privacyGets === 1) return fail(500, 'Server error. Please try again later.');
      return ok(serverPrivacy);
    };

    render(<AccountSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('settings-load-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('settings-load-error')).toHaveTextContent(
      'Server error. Please try again later.',
    );

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Profile Discovery' })).toBeInTheDocument();
    });
  });

  it('keeps drafts local-only when the recovery kill-switch is disabled', async () => {
    process.env.NEXT_PUBLIC_SETTINGS_RECOVERY_ENABLED = 'false';
    seedDraft({
      version: 1,
      updatedAt: '2026-10-19T10:00:00.000Z',
      steps: {
        privacy: { ...serverPrivacy, isDiscoverable: false },
      },
    });

    const user = userEvent.setup();
    await renderFlow();

    // Stored drafts are ignored: no restore, no banner, server baseline wins.
    expect(screen.queryByTestId('recovered-draft-banner')).toBeNull();
    expect(screen.getByTestId('step-badge-privacy')).toHaveTextContent('No changes');
    expect(screen.getByRole('switch', { name: 'Profile Discovery' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Edits stay in-session only; the stored draft is never rewritten.
    await user.click(screen.getByRole('switch', { name: 'Profile Discovery' }));
    expect(
      within(screen.getByTestId('step-rail-privacy')).getByText('Unsaved changes'),
    ).toBeInTheDocument();
    expect(store.get(SETTINGS_DRAFT_STORAGE_KEY)).toContain('2026-10-19T10:00:00.000Z');
  });
});
