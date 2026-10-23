import {
  SETTINGS_DRAFT_STORAGE_KEY,
  SETTINGS_DRAFT_VERSION,
  SettingsStepError,
  canRetryRecord,
  classifySaveFailure,
  clearDraftEnvelope,
  createStepRecord,
  discardDraft,
  isStepDirty,
  mergeDraft,
  readDraftEnvelope,
  recordDraftEdit,
  recordSaveFailure,
  recordSaveStart,
  recordSaveSuccess,
  releaseSessionExpiry,
  requestStepJson,
  verifySession,
  writeDraftEnvelope,
  DraftStorage,
} from '@/app/lib/settings/accountSettingsRecovery';

function createStorage(initial?: Record<string, string>) {
  const data = new Map<string, string>(Object.entries(initial ?? {}));
  const storage: DraftStorage & { data: Map<string, string> } = {
    data,
    getItem: (key) => (data.has(key) ? (data.get(key) as string) : null),
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
  return storage;
}

describe('classifySaveFailure', () => {
  it.each([
    [401, 'session_expired', false, true],
    [403, 'forbidden', false, false],
    [0, 'retryable', true, false],
    [408, 'retryable', true, false],
    [425, 'retryable', true, false],
    [429, 'retryable', true, false],
    [500, 'retryable', true, false],
    [503, 'retryable', true, false],
    [400, 'rejected', false, false],
    [404, 'rejected', false, false],
    [409, 'rejected', false, false],
    [422, 'rejected', false, false],
  ])('classifies HTTP %i', (status, kind, canRetry, requiresReauthorization) => {
    const result = classifySaveFailure({ message: 'boom', status: status as number });
    expect(result.kind).toBe(kind);
    expect(result.canRetry).toBe(canRetry);
    expect(result.requiresReauthorization).toBe(requiresReauthorization);
  });

  it('treats an unknown status as retryable', () => {
    expect(classifySaveFailure({ message: 'boom' })).toEqual({
      kind: 'retryable',
      canRetry: true,
      requiresReauthorization: false,
    });
  });
});

describe('draft envelope codec', () => {
  it('returns null when storage is unavailable or empty', () => {
    expect(readDraftEnvelope(undefined)).toBeNull();
    expect(readDraftEnvelope(createStorage())).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    const storage = createStorage({ [SETTINGS_DRAFT_STORAGE_KEY]: '{not-json' });
    expect(readDraftEnvelope(storage)).toBeNull();
  });

  it('returns null for a non-object payload', () => {
    const storage = createStorage({ [SETTINGS_DRAFT_STORAGE_KEY]: '["array"]' });
    expect(readDraftEnvelope(storage)).toBeNull();
  });

  it('returns null for a schema version mismatch', () => {
    const storage = createStorage({
      [SETTINGS_DRAFT_STORAGE_KEY]: JSON.stringify({
        version: SETTINGS_DRAFT_VERSION + 1,
        updatedAt: 'now',
        steps: { privacy: { a: 1 } },
      }),
    });
    expect(readDraftEnvelope(storage)).toBeNull();
  });

  it('returns null when steps is structurally invalid', () => {
    const storage = createStorage({
      [SETTINGS_DRAFT_STORAGE_KEY]: JSON.stringify({ version: 1, updatedAt: 'x', steps: 'nope' }),
    });
    expect(readDraftEnvelope(storage)).toBeNull();
  });

  it('drops malformed step entries, unknown step ids, and invalid resume positions', () => {
    const storage = createStorage({
      [SETTINGS_DRAFT_STORAGE_KEY]: JSON.stringify({
        version: 1,
        updatedAt: 'when',
        activeStep: 'bogus',
        steps: {
          privacy: 'not-an-object',
          notifications: { inApp: false },
          review: { ignored: true },
          profile: { alsoIgnored: true },
        },
      }),
    });

    const envelope = readDraftEnvelope(storage);
    expect(envelope).not.toBeNull();
    expect(envelope?.activeStep).toBeUndefined();
    expect(envelope?.steps.privacy).toBeUndefined();
    expect(envelope?.steps.notifications).toEqual({ inApp: false });
    expect((envelope?.steps as Record<string, unknown>).profile).toBeUndefined();
    expect((envelope?.steps as Record<string, unknown>).review).toBeUndefined();
  });

  it('round-trips dirty drafts and the resume position', () => {
    const storage = createStorage();
    const ok = writeDraftEnvelope(storage, { privacy: { isDiscoverable: false } }, 'notifications');
    expect(ok).toBe(true);

    const envelope = readDraftEnvelope(storage);
    expect(envelope?.version).toBe(SETTINGS_DRAFT_VERSION);
    expect(envelope?.activeStep).toBe('notifications');
    expect(envelope?.steps.privacy).toEqual({ isDiscoverable: false });
  });

  it('clears the key when no step is dirty', () => {
    const storage = createStorage({
      [SETTINGS_DRAFT_STORAGE_KEY]: JSON.stringify({ version: 1, steps: { privacy: { a: 1 } } }),
    });
    expect(writeDraftEnvelope(storage, {}, 'privacy')).toBe(true);
    expect(storage.getItem(SETTINGS_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('prunes empty and unknown step entries before writing', () => {
    const storage = createStorage();
    writeDraftEnvelope(storage, {
      privacy: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      review: { bogus: true } as any,
      notifications: { inApp: false },
    });

    const envelope = readDraftEnvelope(storage);
    expect(Object.keys(envelope?.steps ?? {})).toEqual(['notifications']);
  });

  it('reports failure instead of throwing when storage rejects the write', () => {
    const storage = createStorage();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(writeDraftEnvelope(storage, { privacy: { a: 1 } }, 'privacy')).toBe(false);
  });

  it('never throws while clearing unavailable storage', () => {
    const throwing = createStorage();
    throwing.removeItem = () => {
      throw new Error('denied');
    };
    expect(() => clearDraftEnvelope(throwing)).not.toThrow();
    expect(() => clearDraftEnvelope(undefined)).not.toThrow();
  });
});

describe('mergeDraft', () => {
  const baseline = {
    isDiscoverable: true,
    canReceiveReplies: true,
    quietHoursStart: '22:00' as string | null,
    reactions: { inApp: true, email: true, push: true },
  };

  it('returns the baseline when no draft is stored', () => {
    expect(mergeDraft(baseline, undefined)).toBe(baseline);
  });

  it('restores changed scalar values', () => {
    const merged = mergeDraft(baseline, { isDiscoverable: false });
    expect(merged.isDiscoverable).toBe(false);
    expect(merged.canReceiveReplies).toBe(true);
  });

  it('ignores unknown draft keys', () => {
    const merged = mergeDraft(baseline, { injected: 'value' } as Record<string, unknown>);
    expect('injected' in merged).toBe(false);
  });

  it('drops type-drifted values from older sessions', () => {
    const merged = mergeDraft(baseline, { isDiscoverable: 'definitely' });
    expect(merged.isDiscoverable).toBe(true);
  });

  it('merges nested channel objects key by key', () => {
    const merged = mergeDraft(baseline, {
      reactions: { inApp: false, unknownChannel: true },
    });
    expect(merged.reactions).toEqual({ inApp: false, email: true, push: true });
  });

  it('accepts a scalar draft for a nullable field but rejects object drift', () => {
    expect(mergeDraft(baseline, { quietHoursStart: null }).quietHoursStart).toBeNull();
    expect(
      mergeDraft(baseline, { quietHoursStart: { nested: true } }).quietHoursStart,
    ).toBe('22:00');
  });
});

describe('step records', () => {
  const server = { isDiscoverable: true, canReceiveReplies: true };

  it('starts pristine and clean', () => {
    const record = createStepRecord(server);
    expect(record.state).toBe('pristine');
    expect(isStepDirty(record)).toBe(false);
    expect(canRetryRecord(record)).toBe(false);
  });

  it('marks edits as unsaved and reverts to pristine when re-applied', () => {
    const record = createStepRecord(server);
    const edited = recordDraftEdit(record, { ...server, isDiscoverable: false });
    expect(edited.state).toBe('unsaved');
    expect(isStepDirty(edited)).toBe(true);

    const reverted = recordDraftEdit(edited, server);
    expect(reverted.state).toBe('pristine');
    expect(isStepDirty(reverted)).toBe(false);
  });

  it('keeps the failure visible while a corrective edit is made after a retryable failure', () => {
    const record = recordSaveFailure(createStepRecord(server), {
      message: 'Server error. Please try again later.',
      status: 500,
    });
    expect(record.state).toBe('failed');
    expect(record.failure).not.toBeNull();

    const edited = recordDraftEdit(record, { ...server, canReceiveReplies: false });
    expect(edited.state).toBe('unsaved');
    expect(edited.failure).not.toBeNull();

    const reverted = recordDraftEdit(edited, server);
    expect(reverted.state).toBe('pristine');
    expect(reverted.failure).toBeNull();
  });

  it('ignores edits while a save is in flight', () => {
    const saving = recordSaveStart(createStepRecord(server));
    expect(saving.state).toBe('saving');
    const edited = recordDraftEdit(saving, { ...server, isDiscoverable: false });
    expect(edited.draft).toEqual(server);
    expect(edited.state).toBe('saving');
  });

  it('keeps the session-expired state locked while editing', () => {
    const expired = recordSaveFailure(createStepRecord(server), {
      message: 'Your session has expired. Please log in again.',
      status: 401,
    });
    expect(expired.state).toBe('session_expired');
    expect(expired.failure?.classification.requiresReauthorization).toBe(true);
    expect(canRetryRecord(expired)).toBe(false);

    const edited = recordDraftEdit(expired, { ...server, isDiscoverable: false });
    expect(edited.state).toBe('session_expired');
    expect(edited.draft.isDiscoverable).toBe(false);
  });

  it('records a successful save as the new confirmed baseline', () => {
    const edited = recordDraftEdit(createStepRecord(server), {
      ...server,
      isDiscoverable: false,
    });
    const saved = recordSaveSuccess(edited, { ...server, isDiscoverable: false });
    expect(saved.state).toBe('saved');
    expect(saved.baseline.isDiscoverable).toBe(false);
    expect(isStepDirty(saved)).toBe(false);
    expect(saved.failure).toBeNull();
  });

  it('preserves the draft and marks transient failures as explicitly retryable', () => {
    const edited = recordDraftEdit(createStepRecord(server), {
      ...server,
      isDiscoverable: false,
    });
    const failed = recordSaveFailure(edited, {
      message: 'Network error. Please check your connection and try again.',
      status: 0,
    });
    expect(failed.state).toBe('failed');
    expect(failed.draft.isDiscoverable).toBe(false);
    expect(isStepDirty(failed)).toBe(true);
    expect(failed.failure?.classification.kind).toBe('retryable');
    expect(canRetryRecord(failed)).toBe(true);
  });

  it('does not offer retry for forbidden rejections', () => {
    const failed = recordSaveFailure(createStepRecord(server), {
      message: 'You do not have permission to perform this action.',
      status: 403,
    });
    expect(failed.state).toBe('failed');
    expect(canRetryRecord(failed)).toBe(false);
    expect(failed.failure?.classification.kind).toBe('forbidden');
  });

  it('releases session expiry back to an editable state without losing the draft', () => {
    const expired = recordSaveFailure(
      recordDraftEdit(createStepRecord(server), { ...server, isDiscoverable: false }),
      { message: 'Your session has expired. Please log in again.', status: 401 },
    );
    const released = releaseSessionExpiry(expired);
    expect(released.state).toBe('unsaved');
    expect(released.failure).toBeNull();
    expect(released.draft.isDiscoverable).toBe(false);
    expect(isStepDirty(released)).toBe(true);
  });

  it('leaves other states untouched when releasing session expiry', () => {
    const record = createStepRecord(server);
    expect(releaseSessionExpiry(record)).toBe(record);
  });

  it('discards local edits back to the server baseline', () => {
    const failed = recordSaveFailure(
      recordDraftEdit(createStepRecord(server), { ...server, isDiscoverable: false }),
      { message: 'Nope', status: 422 },
    );
    const discarded = discardDraft(failed);
    expect(discarded.state).toBe('pristine');
    expect(discarded.draft).toEqual(server);
    expect(discarded.failure).toBeNull();
  });
});

describe('requestStepJson', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns parsed data for successful responses', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    await expect(requestStepJson('/api/users/privacy-settings')).resolves.toEqual({ ok: true });
  });

  it('throws a SettingsStepError carrying the response status', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Server error. Please try again later.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    await expect(requestStepJson('/api/users/privacy-settings')).rejects.toMatchObject({
      name: 'SettingsStepError',
      apiError: { status: 500, message: 'Server error. Please try again later.' },
    });
    await expect(requestStepJson('/api/users/privacy-settings')).rejects.toBeInstanceOf(
      SettingsStepError,
    );
  });

  it('normalizes 401 responses so authorization failures are classifiable', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Your session has expired. Please log in again.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const error = await requestStepJson('/api/users/privacy-settings').catch(
      (caught: unknown) => caught as SettingsStepError,
    );
    expect(classifySaveFailure(error.apiError).requiresReauthorization).toBe(true);
  });

  it('normalizes network failures to a retryable status', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;

    const error = await requestStepJson('/api/users/privacy-settings').catch(
      (caught: unknown) => caught as SettingsStepError,
    );
    expect(error.apiError.status).toBe(0);
    expect(classifySaveFailure(error.apiError).canRetry).toBe(true);
  });
});

describe('verifySession', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('resolves true for a live session', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: { id: 'u1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    await expect(verifySession()).resolves.toBe(true);
  });

  it('resolves false for an expired session', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Unauthenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    await expect(verifySession()).resolves.toBe(false);
  });

  it('resolves false when the session check cannot reach the network', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;
    await expect(verifySession()).resolves.toBe(false);
  });
});
