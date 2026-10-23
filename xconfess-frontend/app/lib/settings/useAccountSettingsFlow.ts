'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ACCOUNT_SETTINGS_STEP_IDS,
  AccountSettingsStepId,
  PERSISTED_STEP_IDS,
  PersistedStepId,
  SettingsDraftEnvelope,
  StepRecord,
  canRetryRecord,
  classifySaveFailure,
  clearDraftEnvelope,
  createStepRecord,
  deepEqual,
  discardDraft,
  isStepDirty,
  mergeDraft,
  readDraftEnvelope,
  recordDraftEdit,
  recordSaveFailure,
  recordSaveStart,
  recordSaveSuccess,
  releaseSessionExpiry,
  toSettingsStepError,
  verifySession,
  writeDraftEnvelope,
  DraftStorage,
} from './accountSettingsRecovery';

/**
 * Operational kill-switch for local draft persistence. Defaults to enabled;
 * set NEXT_PUBLIC_SETTINGS_RECOVERY_ENABLED=false to disable storing unsaved
 * input locally (in-session editing and per-step states keep working).
 */
export function isDraftRecoveryEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SETTINGS_RECOVERY_ENABLED !== 'false';
}

function getStorage(): DraftStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export interface SettingsStepDefinition<T extends Record<string, unknown>> {
  id: PersistedStepId;
  label: string;
  load(): Promise<T>;
  persist(values: T, stepUpToken?: string): Promise<T>;
}

/** Erased definition type accepted by the flow hook (method syntax keeps it bivariant). */
export type SettingsFlowStep = SettingsStepDefinition<Record<string, unknown>>;

export type FlowPhase = 'loading' | 'ready' | 'load_failed';

export interface FlowLoadError {
  message: string;
  requiresReauthorization: boolean;
}

export type SaveOutcome =
  | { outcome: 'saved' }
  | { outcome: 'skipped' }
  | { outcome: 'noop' }
  | { outcome: 'failed'; message: string; canRetry: boolean }
  | { outcome: 'session_expired'; message: string };

export type StepRecords = Partial<Record<PersistedStepId, StepRecord<Record<string, unknown>>>>;

export interface SavePendingResult {
  saved: PersistedStepId[];
  blocked: SaveOutcome | null;
}

/**
 * Drives the multi-step account settings flow:
 *
 * - hydrates server baselines and restores unsaved drafts from the previous
 *   session (recovery after navigation/network interruption),
 * - tracks explicit per-step persistence state,
 * - persists edits locally on every change (best-effort, honestly surfaced),
 * - saves with a double-submit guard and classifies failures so retries are
 *   only offered when they can actually succeed,
 * - blocks retry after 401 until the session is revalidated,
 * - keeps drafts untouched across back/next navigation.
 */
export function useAccountSettingsFlow(definitions: SettingsFlowStep[]) {
  const [phase, setPhase] = useState<FlowPhase>('loading');
  const [loadError, setLoadError] = useState<FlowLoadError | null>(null);
  const [steps, setSteps] = useState<StepRecords>({});
  const [currentStepId, setCurrentStepId] = useState<AccountSettingsStepId>('privacy');
  const [restoredStepIds, setRestoredStepIds] = useState<PersistedStepId[]>([]);
  const [restoredNoticeVisible, setRestoredNoticeVisible] = useState(false);
  const [draftPersistWarning, setDraftPersistWarning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const stepsRef = useRef<StepRecords>({});
  const activeStepRef = useRef<AccountSettingsStepId>('privacy');
  const savingRef = useRef<Set<PersistedStepId>>(new Set());
  const definitionsRef = useRef<SettingsFlowStep[]>(definitions);
  definitionsRef.current = definitions;

  const commitSteps = useCallback((updater: (prev: StepRecords) => StepRecords) => {
    setSteps((prev) => {
      const next = updater(prev);
      stepsRef.current = next;
      return next;
    });
  }, []);

  const persistEnvelope = useCallback(
    (snapshot: StepRecords, activeStep: AccountSettingsStepId) => {
      if (!isDraftRecoveryEnabled()) return;
      const draftSteps: Partial<Record<PersistedStepId, Record<string, unknown>>> = {};
      for (const id of PERSISTED_STEP_IDS) {
        const record = snapshot[id];
        if (record && isStepDirty(record)) {
          draftSteps[id] = record.draft;
        }
      }
      const hasDirtySteps = Object.keys(draftSteps).length > 0;
      const ok = writeDraftEnvelope(getStorage(), draftSteps, activeStep);
      setDraftPersistWarning(hasDirtySteps && !ok);
    },
    [],
  );

  const hydrate = useCallback(async () => {
    setPhase('loading');
    setLoadError(null);
    try {
      const loaded = await Promise.all(definitionsRef.current.map((def) => def.load()));
      const envelope: SettingsDraftEnvelope | null = isDraftRecoveryEnabled()
        ? readDraftEnvelope(getStorage())
        : null;

      const next: StepRecords = {};
      const restored: PersistedStepId[] = [];
      definitionsRef.current.forEach((def, index) => {
        const baseline = loaded[index] ?? {};
        let record = createStepRecord<Record<string, unknown>>(baseline);
        const storedDraft = envelope?.steps[def.id];
        if (storedDraft) {
          const merged = mergeDraft(baseline, storedDraft);
          if (!deepEqual(merged, baseline)) {
            record = { ...record, draft: merged, state: 'unsaved' };
            restored.push(def.id);
          }
        }
        next[def.id] = record;
      });

      const storedActive = envelope?.activeStep;
      const nextActive: AccountSettingsStepId =
        storedActive && ACCOUNT_SETTINGS_STEP_IDS.includes(storedActive)
          ? storedActive
          : 'privacy';

      stepsRef.current = next;
      activeStepRef.current = nextActive;
      setSteps(next);
      setCurrentStepId(nextActive);
      setRestoredStepIds(restored);
      setRestoredNoticeVisible(restored.length > 0);
      setFinished(false);
      setPhase('ready');
    } catch (error) {
      const stepError = await toSettingsStepError(error);
      setLoadError({
        message: stepError.apiError.message,
        requiresReauthorization: classifySaveFailure(stepError.apiError)
          .requiresReauthorization,
      });
      setPhase('load_failed');
    }
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate, reloadToken]);

  // Persist unsaved input (and resume position) whenever the flow changes.
  useEffect(() => {
    if (phase !== 'ready') return;
    persistEnvelope(steps, currentStepId);
  }, [phase, steps, currentStepId, persistEnvelope]);

  const retryLoad = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  const updateDraft = useCallback(
    (id: PersistedStepId, updater: (draft: Record<string, unknown>) => Record<string, unknown>) => {
      commitSteps((prev) => {
        const record = prev[id];
        if (!record) return prev;
        const draft = updater(record.draft);
        return { ...prev, [id]: recordDraftEdit(record, draft) };
      });
      setFinished(false);
    },
    [commitSteps],
  );

  const saveStep = useCallback(
    async (id: PersistedStepId, stepUpToken?: string): Promise<SaveOutcome> => {
      if (savingRef.current.has(id)) return { outcome: 'skipped' };
      const definition = definitionsRef.current.find((def) => def.id === id);
      const record = stepsRef.current[id];
      if (!definition || !record) return { outcome: 'skipped' };

      if (record.state === 'session_expired') {
        return {
          outcome: 'session_expired',
          message: record.failure?.message ?? 'Your session has expired. Please log in again.',
        };
      }
      if (record.state === 'saving') return { outcome: 'skipped' };
      if (!isStepDirty(record)) return { outcome: 'noop' };

      savingRef.current.add(id);
      commitSteps((prev) => {
        const current = prev[id];
        return current ? { ...prev, [id]: recordSaveStart(current) } : prev;
      });

      try {
        const confirmed = await definition.persist(record.draft, stepUpToken);
        commitSteps((prev) => {
          const current = prev[id];
          return current ? { ...prev, [id]: recordSaveSuccess(current, confirmed) } : prev;
        });
        return { outcome: 'saved' };
      } catch (error) {
        const stepError = await toSettingsStepError(error);
        const classification = classifySaveFailure(stepError.apiError);
        commitSteps((prev) => {
          const current = prev[id];
          return current ? { ...prev, [id]: recordSaveFailure(current, stepError.apiError) } : prev;
        });
        return classification.kind === 'session_expired'
          ? { outcome: 'session_expired', message: stepError.apiError.message }
          : {
              outcome: 'failed',
              message: stepError.apiError.message,
              canRetry: classification.canRetry,
            };
      } finally {
        savingRef.current.delete(id);
      }
    },
    [commitSteps],
  );

  const retryStep = useCallback(
    async (id: PersistedStepId, stepUpToken?: string): Promise<SaveOutcome> => {
      const record = stepsRef.current[id];
      if (!record || !canRetryRecord(record)) return { outcome: 'skipped' };
      return saveStep(id, stepUpToken);
    },
    [saveStep],
  );

  const savePendingSteps = useCallback(
    async (stepUpToken?: string): Promise<SavePendingResult> => {
    const saved: PersistedStepId[] = [];
    let blocked: SaveOutcome | null = null;
    const handled = new Set<PersistedStepId>();

    for (const definition of definitionsRef.current) {
      const id = definition.id;
      if (handled.has(id)) continue;
      const record = stepsRef.current[id];
      if (!record) continue;

      if (record.state === 'session_expired') {
        blocked = {
          outcome: 'session_expired',
          message: record.failure?.message ?? 'Your session has expired. Please log in again.',
        };
        break;
      }
      if (record.state === 'saving') {
        blocked = { outcome: 'skipped' };
        break;
      }
      if (!isStepDirty(record)) continue;

      handled.add(id);
      const outcome = await saveStep(
        id,
        id === 'privacy' ? stepUpToken : undefined,
      );
      if (outcome.outcome === 'saved') {
        saved.push(id);
        continue;
      }
      if (outcome.outcome === 'noop') continue;
      blocked = outcome;
      break;
    }

    return { saved, blocked };
    },
    [saveStep],
  );

  const resumeSession = useCallback(async (): Promise<boolean> => {
    const alive = await verifySession();
    if (!alive) return false;
    commitSteps((prev) => {
      const next: StepRecords = {};
      for (const [key, record] of Object.entries(prev)) {
        next[key as PersistedStepId] = record ? releaseSessionExpiry(record) : record;
      }
      return next;
    });
    return true;
  }, [commitSteps]);

  const discardStep = useCallback(
    (id: PersistedStepId) => {
      commitSteps((prev) => {
        const record = prev[id];
        return record ? { ...prev, [id]: discardDraft(record) } : prev;
      });
    },
    [commitSteps],
  );

  const goToStep = useCallback((id: AccountSettingsStepId) => {
    activeStepRef.current = id;
    setCurrentStepId(id);
  }, []);

  const currentIndex = ACCOUNT_SETTINGS_STEP_IDS.indexOf(currentStepId);

  const goNext = useCallback(() => {
    const index = ACCOUNT_SETTINGS_STEP_IDS.indexOf(activeStepRef.current);
    const next = ACCOUNT_SETTINGS_STEP_IDS[index + 1];
    if (next) goToStep(next);
  }, [goToStep]);

  const goBack = useCallback(() => {
    const index = ACCOUNT_SETTINGS_STEP_IDS.indexOf(activeStepRef.current);
    const previous = ACCOUNT_SETTINGS_STEP_IDS[index - 1];
    if (previous) goToStep(previous);
  }, [goToStep]);

  const complete = useCallback(() => {
    clearDraftEnvelope(getStorage());
    setDraftPersistWarning(false);
    setFinished(true);
  }, []);

  const pendingStepIds = useMemo(() => {
    if (phase !== 'ready') return [];
    return PERSISTED_STEP_IDS.filter((id) => {
      const record = steps[id];
      if (!record) return false;
      return (
        isStepDirty(record) ||
        record.state === 'saving' ||
        record.state === 'failed' ||
        record.state === 'session_expired'
      );
    });
  }, [phase, steps]);

  const sessionExpiredStepIds = useMemo(
    () =>
      PERSISTED_STEP_IDS.filter((id) => steps[id]?.state === 'session_expired'),
    [steps],
  );

  const isSaving = useMemo(
    () => PERSISTED_STEP_IDS.some((id) => steps[id]?.state === 'saving'),
    [steps],
  );

  const getStep = useCallback((id: PersistedStepId) => stepsRef.current[id], []);

  return {
    phase,
    loadError,
    retryLoad,
    steps,
    getStep,
    restoredStepIds,
    restoredNoticeVisible,
    dismissRestoredNotice: () => setRestoredNoticeVisible(false),
    draftPersistWarning,
    currentStepId,
    currentIndex,
    isFirstStep: currentIndex <= 0,
    isLastStep: currentIndex >= ACCOUNT_SETTINGS_STEP_IDS.length - 1,
    goToStep,
    goNext,
    goBack,
    updateDraft,
    saveStep,
    retryStep,
    savePendingSteps,
    discardStep,
    resumeSession,
    complete,
    finished,
    pendingStepIds,
    sessionExpiredStepIds,
    isSaving,
    allStepsPersisted: phase === 'ready' && pendingStepIds.length === 0,
  };
}
