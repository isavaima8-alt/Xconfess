"use client";

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bell,
  CheckCircle2,
  RotateCcw,
  Shield,
} from 'lucide-react';
import { useGlobalToast } from '@/app/components/common/Toast';
import StepUpModal from '@/app/components/admin/StepUpModal';
import { useStepUp } from '@/app/hooks/useStepUp';
import { stepUpHeader } from '@/app/lib/api/stepUp';
import {
  ACCOUNT_SETTINGS_STEP_IDS,
  AccountSettingsStepId,
  PERSISTED_STEP_IDS,
  PersistedStepId,
  StepRecord,
  canRetryRecord,
  isStepDirty,
  requestStepJson,
} from '@/app/lib/settings/accountSettingsRecovery';
import {
  SaveOutcome,
  SettingsFlowStep,
  SettingsStepDefinition,
  useAccountSettingsFlow,
} from '@/app/lib/settings/useAccountSettingsFlow';

type PrivacyValues = {
  isDiscoverable: boolean;
  canReceiveReplies: boolean;
  showReactions: boolean;
  dataProcessingConsent: boolean;
};

type ChannelPrefs = {
  inApp: boolean;
  email: boolean;
  push: boolean;
};

type NotificationValues = {
  reactions: ChannelPrefs;
  comments: ChannelPrefs;
  system: ChannelPrefs;
  enableQuietHours: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
};

type NotificationPreferencesResponse = {
  reactions?: Partial<ChannelPrefs>;
  comments?: Partial<ChannelPrefs>;
  system?: Partial<ChannelPrefs>;
  enableQuietHours?: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
};

const privacyStep: SettingsStepDefinition<PrivacyValues> = {
  id: 'privacy',
  label: 'Privacy',
  async load() {
    return requestStepJson<PrivacyValues>('/api/users/privacy-settings', {
      credentials: 'include',
    });
  },
  async persist(values, stepUpToken) {
    return requestStepJson<PrivacyValues>('/api/users/privacy-settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...stepUpHeader(stepUpToken),
      },
      credentials: 'include',
      body: JSON.stringify(values),
    });
  },
};

const notificationsStep: SettingsStepDefinition<NotificationValues> = {
  id: 'notifications',
  label: 'Notifications',
  async load() {
    const data = await requestStepJson<NotificationPreferencesResponse>(
      '/api/users/notification-preferences',
      { credentials: 'include' },
    );
    return {
      reactions: { inApp: true, email: true, push: true, ...(data.reactions ?? {}) },
      comments: { inApp: true, email: true, push: true, ...(data.comments ?? {}) },
      system: { inApp: true, email: true, push: true, ...(data.system ?? {}) },
      enableQuietHours: data.enableQuietHours ?? false,
      quietHoursStart: data.quietHoursStart ?? '22:00',
      quietHoursEnd: data.quietHoursEnd ?? '08:00',
    };
  },
  async persist(values) {
    const confirmed = await requestStepJson<NotificationPreferencesResponse>(
      '/api/users/notification-preferences',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(values),
      },
    );
    return {
      reactions: { ...values.reactions, ...(confirmed.reactions ?? {}) },
      comments: { ...values.comments, ...(confirmed.comments ?? {}) },
      system: { ...values.system, ...(confirmed.system ?? {}) },
      enableQuietHours: confirmed.enableQuietHours ?? values.enableQuietHours,
      quietHoursStart: confirmed.quietHoursStart ?? values.quietHoursStart,
      quietHoursEnd: confirmed.quietHoursEnd ?? values.quietHoursEnd,
    };
  },
};

const STEP_DEFINITIONS: SettingsFlowStep[] = [privacyStep, notificationsStep];

const STEP_LABELS: Record<AccountSettingsStepId, string> = {
  privacy: 'Privacy',
  notifications: 'Notifications',
  review: 'Review',
};

const PRIVACY_ROWS: {
  key: keyof PrivacyValues;
  label: string;
  description: string;
}[] = [
  {
    key: 'isDiscoverable',
    label: 'Profile Discovery',
    description: 'Allow others to find your profile in search and the user directory.',
  },
  {
    key: 'canReceiveReplies',
    label: 'Allow Replies',
    description: 'Let other users reply to your confessions.',
  },
  {
    key: 'showReactions',
    label: 'Show Reactions',
    description: 'Display emoji reactions on your confessions.',
  },
  {
    key: 'dataProcessingConsent',
    label: 'Data Processing Consent',
    description: 'Allow processing of your data for service improvement and analytics.',
  },
];

const NOTIFICATION_CATEGORIES: { key: 'reactions' | 'comments' | 'system'; label: string }[] = [
  { key: 'reactions', label: 'Reactions' },
  { key: 'comments', label: 'Comments' },
  { key: 'system', label: 'System updates' },
];

const NOTIFICATION_CHANNELS: { key: keyof ChannelPrefs; label: string }[] = [
  { key: 'inApp', label: 'In-App' },
  { key: 'email', label: 'Email' },
  { key: 'push', label: 'Push' },
];

interface Badge {
  text: string;
  className: string;
}

function recordBadge(record?: StepRecord<Record<string, unknown>>): Badge {
  if (!record) {
    return { text: 'Not started', className: 'bg-gray-700 text-gray-300 border-gray-600' };
  }
  switch (record.state) {
    case 'saving':
      return { text: 'Saving...', className: 'bg-blue-900/60 text-blue-300 border-blue-700' };
    case 'session_expired':
      return { text: 'Session expired', className: 'bg-red-900/60 text-red-300 border-red-700' };
    case 'failed':
      return { text: 'Failed to save', className: 'bg-red-900/60 text-red-300 border-red-700' };
    case 'unsaved':
      return { text: 'Unsaved changes', className: 'bg-yellow-900/60 text-yellow-300 border-yellow-700' };
    case 'saved':
      return { text: 'Saved', className: 'bg-green-900/60 text-green-300 border-green-700' };
    default:
      return { text: 'No changes', className: 'bg-gray-700 text-gray-300 border-gray-600' };
  }
}

function ToggleSwitch({
  id,
  checked,
  disabled,
  labelledBy,
  ariaLabel,
  onChange,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  labelledBy?: string;
  ariaLabel?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      id={id}
      role="switch"
      type="button"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:cursor-not-allowed disabled:opacity-60 ${
        checked ? 'bg-purple-600' : 'bg-gray-600'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function StepActions({
  stepId,
  label,
  record,
  onSave,
  onRetry,
  onDiscard,
}: {
  stepId: PersistedStepId;
  label: string;
  record: StepRecord<Record<string, unknown>>;
  onSave: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const saving = record.state === 'saving';
  const dirty = isStepDirty(record);
  const blockedBySession = record.state === 'session_expired';

  return (
    <div className="space-y-3">
      {record.failure && (
        <p
          role="alert"
          data-testid={`failure-${stepId}`}
          className="rounded-lg border border-red-800 bg-red-900/20 px-3 py-2 text-sm text-red-200"
        >
          {record.failure.message}
          {record.state === 'failed' && !record.failure.classification.canRetry
            ? ' This change cannot be retried as-is — adjust the value or discard your changes.'
            : ''}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {dirty && (
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-750 hover:text-white disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" />
            Discard
          </button>
        )}

        {canRetryRecord(record) && (
          <button
            type="button"
            onClick={onRetry}
            disabled={saving}
            className="rounded-lg border border-amber-700 bg-amber-900/40 px-4 py-2 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-900/70 disabled:opacity-50"
          >
            Retry
          </button>
        )}

        <button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty || blockedBySession}
          className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving...' : `Save ${label.toLowerCase()}`}
        </button>
      </div>
    </div>
  );
}

export default function AccountSettingsPage() {
  const toast = useGlobalToast();
  const flow = useAccountSettingsFlow(STEP_DEFINITIONS);
  const stepUp = useStepUp();
  const { steps, currentStepId } = flow;

  const privacyRecord = steps.privacy;
  const notificationsRecord = steps.notifications;

  const handleOutcome = useCallback(
    (outcome: SaveOutcome, savedLabel: string) => {
      if (outcome.outcome === 'saved') {
        toast.success(`${savedLabel} saved`);
      } else if (outcome.outcome === 'failed') {
        toast.error(outcome.message);
      } else if (outcome.outcome === 'session_expired') {
        toast.error('Your session has expired. Sign in again, then check your session.');
      }
    },
    [toast],
  );

  const handleSave = useCallback(
    async (id: PersistedStepId, label: string) => {
      const save = async (token?: string) =>
        handleOutcome(await flow.saveStep(id, token), label);
      if (id === 'privacy') {
        stepUp.requestStepUp((token) => {
          void save(token);
        });
      } else {
        await save();
      }
    },
    [flow, handleOutcome, stepUp.requestStepUp],
  );

  const handleRetry = useCallback(
    async (id: PersistedStepId, label: string) => {
      const retry = async (token?: string) =>
        handleOutcome(await flow.retryStep(id, token), label);
      if (id === 'privacy') {
        stepUp.requestStepUp((token) => {
          void retry(token);
        });
      } else {
        await retry();
      }
    },
    [flow, handleOutcome, stepUp.requestStepUp],
  );

  const handleSaveAll = useCallback(async () => {
    const saveAll = async (token?: string) => {
      const result = await flow.savePendingSteps(token);
      if (result.blocked?.outcome === 'failed') {
        toast.error(result.blocked.message);
      } else if (result.blocked?.outcome === 'session_expired') {
        toast.error('Your session has expired. Sign in again, then check your session.');
      } else if (result.saved.length > 0) {
        toast.success('Pending settings saved');
      }
    };
    if (flow.pendingStepIds.includes('privacy')) {
      stepUp.requestStepUp((token) => {
        void saveAll(token);
      });
    } else {
      await saveAll();
    }
  }, [flow, stepUp.requestStepUp, toast]);

  const handleResumeSession = useCallback(async () => {
    const alive = await flow.resumeSession();
    if (alive) {
      toast.success('Session verified — you can retry saving now.');
    } else {
      toast.error('Your session is still expired. Sign in again to continue.');
    }
  }, [flow, toast]);

  const reviewBadge = useMemo<Badge>(() => {
    if (flow.phase !== 'ready') {
      return { text: 'Not started', className: 'bg-gray-700 text-gray-300 border-gray-600' };
    }
    if (flow.pendingStepIds.length === 0) {
      return { text: 'All saved', className: 'bg-green-900/60 text-green-300 border-green-700' };
    }
    return {
      text: `${flow.pendingStepIds.length} pending`,
      className: 'bg-yellow-900/60 text-yellow-300 border-yellow-700',
    };
  }, [flow.phase, flow.pendingStepIds]);

  if (flow.phase === 'loading') {
    return (
      <div
        role="status"
        className="flex items-center justify-center min-h-[400px]"
        aria-label="Loading account settings"
      >
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600" />
      </div>
    );
  }

  if (flow.phase === 'load_failed' && flow.loadError) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div
          role="alert"
          data-testid="settings-load-error"
          className="rounded-xl border border-red-800 bg-red-900/20 p-6 text-center"
        >
          <p className="mb-4 text-red-200">{flow.loadError.message}</p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={flow.retryLoad}
              className="rounded-lg bg-red-600 px-4 py-2 text-white transition-colors hover:bg-red-700"
            >
              Retry
            </button>
            {flow.loadError.requiresReauthorization && (
              <Link
                href="/login"
                className="rounded-lg border border-red-700 px-4 py-2 text-red-200 transition-colors hover:bg-red-900/40"
              >
                Sign in again
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isReview = currentStepId === 'review';

  return (
    <div className="max-w-4xl mx-auto p-6">
      <header className="mb-6">
        <h1 className="flex items-center gap-3 text-3xl font-bold text-white">
          <Shield className="h-8 w-8 text-purple-500" />
          Account Settings
        </h1>
        <p className="mt-1 text-gray-400">
          Review each step, save what matters, and pick up where you left off if something is
          interrupted.
        </p>
      </header>

      {flow.restoredNoticeVisible && flow.restoredStepIds.length > 0 && (
        <div
          role="status"
          data-testid="recovered-draft-banner"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-yellow-700/50 bg-yellow-900/20 px-4 py-3"
        >
          <p className="text-sm text-yellow-200">
            Restored unsaved changes from an interrupted session:{' '}
            {flow.restoredStepIds.map((id) => STEP_LABELS[id]).join(', ')}. Review them, then save
            when ready.
          </p>
          <button
            type="button"
            onClick={flow.dismissRestoredNotice}
            className="text-xs font-medium text-yellow-300 underline underline-offset-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {flow.draftPersistWarning && (
        <div
          role="alert"
          data-testid="draft-persist-warning"
          className="mb-4 rounded-xl border border-orange-700/60 bg-orange-900/20 px-4 py-3 text-sm text-orange-200"
        >
          We could not store a local backup of your unsaved input. Keep this tab open until you
          save.
        </div>
      )}

      {flow.sessionExpiredStepIds.length > 0 && (
        <div
          role="alert"
          data-testid="session-expired-banner"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-700/60 bg-red-900/20 px-4 py-3"
        >
          <p className="text-sm text-red-200">
            Your session expired. Your unsaved input is kept on this device — sign in again, then
            check the session to retry saving.
          </p>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm font-medium text-red-200 underline underline-offset-2">
              Sign in
            </Link>
            <button
              type="button"
              onClick={handleResumeSession}
              className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-600"
            >
              Check session
            </button>
          </div>
        </div>
      )}

      <ol
        aria-label="Account settings steps"
        className="mb-6 flex flex-wrap gap-2"
      >
        {ACCOUNT_SETTINGS_STEP_IDS.map((id) => {
          const active = id === currentStepId;
          const badge = id === 'review' ? reviewBadge : recordBadge(steps[id]);
          return (
            <li
              key={id}
              data-testid={`step-rail-${id}`}
              aria-current={active ? 'step' : undefined}
              className="flex-1"
            >
              <button
                type="button"
                onClick={() => flow.goToStep(id)}
                className={`flex w-full flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left transition-colors ${
                  active
                    ? 'border-purple-500 bg-purple-950/30'
                    : 'border-gray-700 bg-gray-800 hover:bg-gray-750'
                }`}
              >
                <span className="text-sm font-semibold text-white">{STEP_LABELS[id]}</span>
                <span
                  data-testid={`step-badge-${id}`}
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${badge.className}`}
                >
                  {badge.text}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <section
        aria-label={STEP_LABELS[currentStepId]}
        className="rounded-xl border border-gray-700/60 bg-gray-800 p-5"
      >
        {currentStepId === 'privacy' && privacyRecord && (
          <PrivacyPanel
            record={privacyRecord}
            onUpdate={(updater) => flow.updateDraft('privacy', updater)}
            onSave={() => handleSave('privacy', 'Privacy')}
            onRetry={() => handleRetry('privacy', 'Privacy')}
            onDiscard={() => flow.discardStep('privacy')}
          />
        )}

        {currentStepId === 'notifications' && notificationsRecord && (
          <NotificationsPanel
            record={notificationsRecord}
            onUpdate={(updater) => flow.updateDraft('notifications', updater)}
            onSave={() => handleSave('notifications', 'Notifications')}
            onRetry={() => handleRetry('notifications', 'Notifications')}
            onDiscard={() => flow.discardStep('notifications')}
          />
        )}

        {isReview && (
          <ReviewPanel
            flow={flow}
            onRetry={handleRetry}
            onSaveAll={handleSaveAll}
          />
        )}
      </section>

      <nav className="mt-6 flex items-center justify-between" aria-label="Settings navigation">
        <button
          type="button"
          onClick={flow.goBack}
          disabled={flow.isFirstStep}
          className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-750 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        {!isReview && (
          <button
            type="button"
            onClick={flow.goNext}
            className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700"
          >
            Next
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </nav>
      <StepUpModal
        isOpen={stepUp.isModalOpen}
        onVerify={stepUp.verify}
        onCancel={stepUp.cancel}
        error={stepUp.error}
        isVerifying={stepUp.isVerifying}
      />
    </div>
  );
}

function PrivacyPanel({
  record,
  onUpdate,
  onSave,
  onRetry,
  onDiscard,
}: {
  record: StepRecord<Record<string, unknown>>;
  onUpdate: (updater: (draft: Record<string, unknown>) => Record<string, unknown>) => void;
  onSave: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const draft = record.draft as PrivacyValues;
  const saving = record.state === 'saving';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-purple-400" />
        <div>
          <h2 className="text-lg font-semibold text-white">Privacy</h2>
          <p className="text-sm text-gray-400">
            Visibility, replies, reactions, and data-processing consent.
          </p>
        </div>
      </div>

      <div className="divide-y divide-gray-700 rounded-lg border border-gray-700/60">
        {PRIVACY_ROWS.map((row) => {
          const inputId = `privacy-${row.key}`;
          const labelId = `${inputId}-label`;
          return (
            <div key={row.key} className="flex items-start justify-between gap-4 p-4">
              <div className="min-w-0">
                <label id={labelId} htmlFor={inputId} className="font-medium text-white">
                  {row.label}
                </label>
                <p className="mt-0.5 text-sm text-gray-400">{row.description}</p>
              </div>
              <ToggleSwitch
                id={inputId}
                labelledBy={labelId}
                checked={draft[row.key]}
                disabled={saving}
                onChange={(value) =>
                  onUpdate((current) => ({
                    ...(current as PrivacyValues),
                    [row.key]: value,
                  }))
                }
              />
            </div>
          );
        })}
      </div>

      <StepActions
        stepId="privacy"
        label="Privacy"
        record={record}
        onSave={onSave}
        onRetry={onRetry}
        onDiscard={onDiscard}
      />
    </div>
  );
}

function NotificationsPanel({
  record,
  onUpdate,
  onSave,
  onRetry,
  onDiscard,
}: {
  record: StepRecord<Record<string, unknown>>;
  onUpdate: (updater: (draft: Record<string, unknown>) => Record<string, unknown>) => void;
  onSave: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const draft = record.draft as NotificationValues;
  const saving = record.state === 'saving';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Bell className="h-5 w-5 text-yellow-400" />
        <div>
          <h2 className="text-lg font-semibold text-white">Notifications</h2>
          <p className="text-sm text-gray-400">
            Choose delivery channels per category and quiet hours.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-700/60">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="p-3 text-left text-sm font-medium text-gray-300">Category</th>
              {NOTIFICATION_CHANNELS.map((channel) => (
                <th key={channel.key} className="p-3 text-center text-sm font-medium text-gray-300">
                  {channel.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_CATEGORIES.map((category) => (
              <tr key={category.key} className="border-b border-gray-700/60 last:border-0">
                <td className="p-3">
                  <span className="text-sm font-medium text-white">{category.label}</span>
                </td>
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const switchId = `notif-${category.key}-${channel.key}`;
                  return (
                    <td key={channel.key} className="p-3 text-center">
                      <span className="inline-flex justify-center">
                        <ToggleSwitch
                          id={switchId}
                          ariaLabel={`${channel.label} notifications for ${category.label}`}
                          checked={draft[category.key][channel.key]}
                          disabled={saving}
                          onChange={(value) =>
                            onUpdate((current) => {
                              const values = current as NotificationValues;
                              return {
                                ...values,
                                [category.key]: {
                                  ...values[category.key],
                                  [channel.key]: value,
                                },
                              };
                            })
                          }
                        />
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-gray-700/60 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <label
              id="quiet-hours-label"
              htmlFor="quiet-hours-toggle"
              className="font-medium text-white"
            >
              Quiet hours
            </label>
            <p className="mt-0.5 text-sm text-gray-400">
              Suppress notifications during the configured window.
            </p>
          </div>
          <ToggleSwitch
            id="quiet-hours-toggle"
            labelledBy="quiet-hours-label"
            checked={draft.enableQuietHours}
            disabled={saving}
            onChange={(value) =>
              onUpdate((current) => ({
                ...(current as NotificationValues),
                enableQuietHours: value,
              }))
            }
          />
        </div>

        {draft.enableQuietHours && (
          <div className="mt-4 flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <label htmlFor="quiet-hours-start" className="text-sm text-gray-300">
                Quiet hours start
              </label>
              <input
                id="quiet-hours-start"
                type="time"
                value={draft.quietHoursStart}
                disabled={saving}
                onChange={(event) =>
                  onUpdate((current) => ({
                    ...(current as NotificationValues),
                    quietHoursStart: event.target.value,
                  }))
                }
                className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="quiet-hours-end" className="text-sm text-gray-300">
                Quiet hours end
              </label>
              <input
                id="quiet-hours-end"
                type="time"
                value={draft.quietHoursEnd}
                disabled={saving}
                onChange={(event) =>
                  onUpdate((current) => ({
                    ...(current as NotificationValues),
                    quietHoursEnd: event.target.value,
                  }))
                }
                className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
              />
            </div>
          </div>
        )}
      </div>

      <StepActions
        stepId="notifications"
        label="Notifications"
        record={record}
        onSave={onSave}
        onRetry={onRetry}
        onDiscard={onDiscard}
      />
    </div>
  );
}

function ReviewPanel({
  flow,
  onRetry,
  onSaveAll,
}: {
  flow: ReturnType<typeof useAccountSettingsFlow>;
  onRetry: (id: PersistedStepId, label: string) => Promise<void>;
  onSaveAll: () => Promise<void>;
}) {
  if (flow.finished) {
    return (
      <div
        data-testid="settings-complete"
        className="flex flex-col items-center gap-3 py-8 text-center"
      >
        <CheckCircle2 className="h-12 w-12 text-green-400" />
        <h2 className="text-xl font-semibold text-white">All settings saved.</h2>
        <p className="text-sm text-gray-400">Your account settings are up to date.</p>
        <Link
          href="/settings/privacy"
          className="text-sm font-medium text-purple-400 underline underline-offset-2"
        >
          Manage privacy settings
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-yellow-400" />
        <div>
          <h2 className="text-lg font-semibold text-white">Review</h2>
          <p className="text-sm text-gray-400">
            Every step shows whether it was saved. Retry only appears when retrying can succeed.
          </p>
        </div>
      </div>

      <ul className="space-y-3">
        {PERSISTED_STEP_IDS.map((id) => {
          const record = flow.steps[id];
          const label = STEP_LABELS[id];
          const badge = recordBadge(record);
          return (
            <li
              key={id}
              data-testid={`review-${id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-700/60 bg-gray-900/40 p-4"
            >
              <div className="flex items-center gap-3">
                <span className="font-medium text-white">{label}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${badge.className}`}
                >
                  {badge.text}
                </span>
                {record?.failure && (
                  <span role="alert" className="text-xs text-red-300">
                    {record.failure.message}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => flow.goToStep(id)}
                  className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-700"
                >
                  Open
                </button>
                {record && canRetryRecord(record) && (
                  <button
                    type="button"
                    onClick={() => onRetry(id, label)}
                    className="rounded-lg border border-amber-700 bg-amber-900/40 px-3 py-1.5 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-900/70"
                  >
                    Retry {label}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {flow.pendingStepIds.length > 0 && (
          <button
            type="button"
            onClick={onSaveAll}
            disabled={flow.isSaving}
            className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-750 disabled:opacity-50"
          >
            Save all pending
          </button>
        )}
        <button
          type="button"
          onClick={flow.complete}
          disabled={flow.isSaving || flow.pendingStepIds.length > 0}
          className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Finish
        </button>
      </div>

      {flow.pendingStepIds.length > 0 && (
        <p className="text-right text-xs text-yellow-500">
          {flow.pendingStepIds.length} step
          {flow.pendingStepIds.length === 1 ? '' : 's'} still need to be saved before you can
          finish.
        </p>
      )}
    </div>
  );
}
