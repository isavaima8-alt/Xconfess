/**
 * Owning boundary for resilient recovery of the multi-step account settings flow.
 *
 * Everything that decides whether a step is persisted, whether a failed save may
 * be retried, and how unsaved input survives navigation/network interruption
 * lives here so the behavior is explicit and unit-testable:
 *
 * - Per-step persistence state machine (`StepPersistenceState`).
 * - Explicit failure classification: 401 requires re-authorization before any
 *   retry, 403/4xx are rejected without a retry affordance, transient failures
 *   (network, 408, 429, 5xx) are explicitly retryable.
 * - Versioned localStorage draft envelope that never throws on corrupt,
 *   outdated, or unavailable storage.
 */
import { ApiError, normalizeApiError } from '@/app/lib/api/errors';

export type PersistedStepId = 'privacy' | 'notifications';

export type AccountSettingsStepId = PersistedStepId | 'review';

export const PERSISTED_STEP_IDS: PersistedStepId[] = ['privacy', 'notifications'];

export const ACCOUNT_SETTINGS_STEP_IDS: AccountSettingsStepId[] = [
  'privacy',
  'notifications',
  'review',
];

export type StepPersistenceState =
  | 'pristine' // server values loaded, no local edits
  | 'unsaved' // local edits not yet confirmed by the server
  | 'saving' // persistence request in flight
  | 'saved' // server confirmed the current draft
  | 'failed' // persistence failed; retry is an explicit decision
  | 'session_expired'; // 401: draft preserved, retry blocked until re-auth

export type SaveFailureKind = 'session_expired' | 'forbidden' | 'retryable' | 'rejected';

export interface SaveFailureClassification {
  kind: SaveFailureKind;
  /** True only when an explicit user-initiated retry can succeed as-is. */
  canRetry: boolean;
  /** True when the session must be revalidated before any further save. */
  requiresReauthorization: boolean;
}

/**
 * Maps a normalized API error to explicit retry/authorization semantics.
 *
 * - 401 -> session expired: retry blocked until the session is revalidated.
 * - 403 -> forbidden: rejected for this payload, no retry affordance.
 * - 0/408/425/429/5xx/unknown -> transient: explicit retry allowed.
 * - other 4xx -> rejected: no retry, the payload itself must change.
 */
export function classifySaveFailure(error: ApiError): SaveFailureClassification {
  const status = error.status;

  if (status === undefined || status === null) {
    return { kind: 'retryable', canRetry: true, requiresReauthorization: false };
  }
  if (status === 401) {
    return { kind: 'session_expired', canRetry: false, requiresReauthorization: true };
  }
  if (status === 403) {
    return { kind: 'forbidden', canRetry: false, requiresReauthorization: false };
  }
  if (status === 0 || status === 408 || status === 425 || status === 429 || status >= 500) {
    return { kind: 'retryable', canRetry: true, requiresReauthorization: false };
  }
  return { kind: 'rejected', canRetry: false, requiresReauthorization: false };
}

// ---------------------------------------------------------------------------
// Draft persistence (localStorage envelope)
// ---------------------------------------------------------------------------

export const SETTINGS_DRAFT_STORAGE_KEY = 'xconfess:accountSettingsDraft';
export const SETTINGS_DRAFT_VERSION = 1;

export interface SettingsDraftEnvelope {
  version: number;
  updatedAt: string;
  activeStep?: AccountSettingsStepId;
  steps: Partial<Record<PersistedStepId, Record<string, unknown>>>;
}

/** Minimal storage contract so tests can inject an in-memory implementation. */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStepId(value: unknown): value is PersistedStepId {
  return value === 'privacy' || value === 'notifications';
}

function isStepIdOrReview(value: unknown): value is AccountSettingsStepId {
  return value === 'privacy' || value === 'notifications' || value === 'review';
}

/**
 * Reads and validates the stored draft envelope. Returns null when storage is
 * unavailable, empty, corrupt, version-mismatched, or structurally invalid —
 * never throws.
 */
export function readDraftEnvelope(
  storage?: DraftStorage | null,
): SettingsDraftEnvelope | null {
  if (!storage) return null;

  let raw: string | null;
  try {
    raw = storage.getItem(SETTINGS_DRAFT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return null;
    if (parsed.version !== SETTINGS_DRAFT_VERSION) return null;
    if (!isPlainObject(parsed.steps)) return null;

    const steps: SettingsDraftEnvelope['steps'] = {};
    for (const [key, value] of Object.entries(parsed.steps)) {
      if (isStepId(key) && isPlainObject(value)) {
        steps[key] = value;
      }
    }

    return {
      version: SETTINGS_DRAFT_VERSION,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      activeStep: isStepIdOrReview(parsed.activeStep) ? parsed.activeStep : undefined,
      steps,
    };
  } catch {
    return null;
  }
}

/**
 * Persists dirty step drafts plus the active step so an interrupted flow can be
 * resumed. Clears the key when no step is dirty. Returns false when storage
 * rejected the write (quota/private mode) so callers can surface it honestly.
 */
export function writeDraftEnvelope(
  storage: DraftStorage | null | undefined,
  steps: Partial<Record<PersistedStepId, Record<string, unknown>>>,
  activeStep?: AccountSettingsStepId,
): boolean {
  if (!storage) return false;

  const cleanSteps: SettingsDraftEnvelope['steps'] = {};
  for (const [key, value] of Object.entries(steps)) {
    if (isStepId(key) && isPlainObject(value) && Object.keys(value).length > 0) {
      cleanSteps[key] = value;
    }
  }

  if (Object.keys(cleanSteps).length === 0) {
    clearDraftEnvelope(storage);
    return true;
  }

  const envelope: SettingsDraftEnvelope = {
    version: SETTINGS_DRAFT_VERSION,
    updatedAt: new Date().toISOString(),
    activeStep,
    steps: cleanSteps,
  };

  try {
    storage.setItem(SETTINGS_DRAFT_STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

export function clearDraftEnvelope(storage?: DraftStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(SETTINGS_DRAFT_STORAGE_KEY);
  } catch {
    // Nothing sensible to do; clearing is best-effort.
  }
}

// ---------------------------------------------------------------------------
// Draft <-> baseline merging
// ---------------------------------------------------------------------------

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => key in b && deepEqual(a[key], b[key]));
  }
  return false;
}

function mergeValue(
  baseline: unknown,
  draft: unknown,
): { matched: boolean; value: unknown } {
  if (Array.isArray(baseline) || Array.isArray(draft)) {
    if (Array.isArray(baseline) && Array.isArray(draft)) {
      return { matched: true, value: draft };
    }
    return { matched: false, value: baseline };
  }

  if (isPlainObject(baseline)) {
    if (!isPlainObject(draft)) return { matched: false, value: baseline };
    const merged: Record<string, unknown> = { ...baseline };
    let touched = false;
    for (const key of Object.keys(baseline)) {
      if (!(key in draft)) continue;
      const result = mergeValue(baseline[key], draft[key]);
      if (result.matched) {
        merged[key] = result.value;
        touched = true;
      }
    }
    return { matched: true, value: touched ? merged : baseline };
  }

  if (baseline === null) {
    // Nullable field: accept scalar drafts only.
    if (
      draft === null ||
      typeof draft === 'string' ||
      typeof draft === 'number' ||
      typeof draft === 'boolean'
    ) {
      return { matched: true, value: draft };
    }
    return { matched: false, value: baseline };
  }

  if (typeof baseline === typeof draft) {
    return { matched: true, value: draft };
  }
  return { matched: false, value: baseline };
}

/**
 * Safely overlays a stored draft onto freshly loaded server values. Only keys
 * that exist in the baseline with a compatible shape are restored; unknown keys
 * and type-drifted values from older sessions are dropped.
 */
export function mergeDraft<T extends Record<string, unknown>>(
  baseline: T,
  draft: Record<string, unknown> | undefined,
): T {
  if (!draft) return baseline;
  const merged: Record<string, unknown> = { ...baseline };
  for (const key of Object.keys(baseline)) {
    if (!(key in draft)) continue;
    const result = mergeValue(baseline[key], draft[key]);
    if (result.matched) {
      merged[key] = result.value;
    }
  }
  return merged as T;
}

// ---------------------------------------------------------------------------
// Step record state machine
// ---------------------------------------------------------------------------

export interface StepFailure {
  message: string;
  classification: SaveFailureClassification;
}

export interface StepRecord<T> {
  /** Last server-confirmed values for this step. */
  baseline: T;
  /** Working copy that survives navigation and interruption until saved. */
  draft: T;
  state: StepPersistenceState;
  failure: StepFailure | null;
}

export function createStepRecord<T>(serverValues: T): StepRecord<T> {
  return { baseline: serverValues, draft: serverValues, state: 'pristine', failure: null };
}

export function isStepDirty<T>(record: StepRecord<T>): boolean {
  return !deepEqual(record.baseline, record.draft);
}

/**
 * Applies a draft edit. Editing during an in-flight save is ignored (the
 * response would overwrite it anyway) and editing while the session is expired
 * stays blocked until the session is revalidated. Reverting to the baseline
 * clears any recorded failure because there is nothing left to persist.
 */
export function recordDraftEdit<T>(
  record: StepRecord<T>,
  draft: T,
): StepRecord<T> {
  if (record.state === 'saving') return record;
  if (record.state === 'session_expired') {
    return { ...record, draft };
  }

  const next: StepRecord<T> = { ...record, draft };
  if (!deepEqual(next.baseline, draft)) {
    // Keep `failure` so an explicit Retry affordance survives a corrective edit.
    return { ...next, state: 'unsaved' };
  }
  if (record.state === 'saved') {
    return { ...next, state: 'saved', failure: null };
  }
  return { ...next, state: 'pristine', failure: null };
}

export function recordSaveStart<T>(record: StepRecord<T>): StepRecord<T> {
  return { ...record, state: 'saving', failure: null };
}

export function recordSaveSuccess<T>(record: StepRecord<T>, confirmed: T): StepRecord<T> {
  return { baseline: confirmed, draft: confirmed, state: 'saved', failure: null };
}

export function recordSaveFailure<T>(
  record: StepRecord<T>,
  apiError: ApiError,
): StepRecord<T> {
  const classification = classifySaveFailure(apiError);
  return {
    ...record,
    state: classification.kind === 'session_expired' ? 'session_expired' : 'failed',
    failure: {
      message: apiError.message || 'Failed to save changes.',
      classification,
    },
  };
}

/**
 * Called after the session has been revalidated. Returns the step to an
 * editable, explicitly retryable state while keeping the draft intact.
 */
export function releaseSessionExpiry<T>(record: StepRecord<T>): StepRecord<T> {
  if (record.state !== 'session_expired') return record;
  const dirty = !deepEqual(record.baseline, record.draft);
  return { ...record, state: dirty ? 'unsaved' : 'pristine', failure: null };
}

export function discardDraft<T>(record: StepRecord<T>): StepRecord<T> {
  return { baseline: record.baseline, draft: record.baseline, state: 'pristine', failure: null };
}

/** True only for transient failures where an explicit retry is meaningful. */
export function canRetryRecord<T>(record: StepRecord<T>): boolean {
  return record.state === 'failed' && record.failure?.classification.canRetry === true;
}

// ---------------------------------------------------------------------------
// Request helpers with explicit failure semantics
// ---------------------------------------------------------------------------

/** Wraps any thrown value so status-based classification is always possible. */
export class SettingsStepError extends Error {
  readonly apiError: ApiError;

  constructor(apiError: ApiError) {
    super(apiError.message);
    this.name = 'SettingsStepError';
    this.apiError = apiError;
  }
}

export async function toSettingsStepError(error: unknown): Promise<SettingsStepError> {
  if (error instanceof SettingsStepError) return error;
  if (error instanceof Response) {
    return new SettingsStepError(await normalizeApiError(error));
  }
  if (error instanceof Error) {
    return new SettingsStepError(await normalizeApiError(error));
  }
  return new SettingsStepError(await normalizeApiError(new Error(String(error))));
}

/**
 * Fetch helper used by step executors. Non-2xx responses, network failures, and
 * unreadable bodies all surface as SettingsStepError carrying a normalized
 * ApiError, so the flow can classify retry/authorization semantics uniformly.
 */
export async function requestStepJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw await toSettingsStepError(error);
  }

  if (!response.ok) {
    throw await toSettingsStepError(response);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw await toSettingsStepError(
      new Error('The server returned an unreadable response. Please try again.'),
    );
  }
}

/**
 * Revalidates the session before an expired step may be retried.
 * A retry is never assumed to work after 401 — the session must prove itself.
 */
export async function verifySession(): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/session', { credentials: 'include' });
    return response.ok;
  } catch {
    return false;
  }
}
