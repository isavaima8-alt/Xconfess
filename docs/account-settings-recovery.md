# Account Settings Recovery

This document describes how the multi-step account settings flow at
`xconfess-frontend/app/(dashboard)/settings/account/page.tsx` survives
interruption, failure, and session expiry without losing unsaved input.

The goal is explicit per-step persistence state: a step is only ever in one
known condition, the UI reports that condition, and retry behavior is decided
by classifying the failure rather than by silently re-firing requests.

## Step model

The flow has three steps. The first two hold user input and are persisted; the
last one is a review summary.

| Step id | Label | Persisted |
|---------|-------|-----------|
| `privacy` | Privacy | yes |
| `notifications` | Notifications | yes |
| `review` | Review | no (summary only) |

Step ids and the persisted subset are defined in
`xconfess-frontend/app/lib/settings/accountSettingsRecovery.ts`
(`ACCOUNT_SETTINGS_STEP_IDS`, `PERSISTED_STEP_IDS`).

## Per-step persistence state

Each persisted step is a `StepRecord` with a `StepPersistenceState`:

| State | Meaning | User affordance |
|-------|---------|-----------------|
| `pristine` | Server values loaded; no local edits | Save disabled |
| `unsaved` | Local edits not yet confirmed by the server | Save enabled; draft backed up locally |
| `saving` | Persistence request in flight | Inputs and Save disabled (double-submit guard) |
| `saved` | Server confirmed the current draft | Badge shows Saved |
| `failed` | Persistence failed; retry is an explicit decision | Retry shown only when retry can succeed |
| `session_expired` | 401: draft preserved, retry blocked until re-auth | Session banner with "Check session"; Save disabled |

These transitions are pure functions in
`xconfess-frontend/app/lib/settings/accountSettingsRecovery.ts`
(`recordDraftEdit`, `recordSaveStart`, `recordSaveSuccess`, `recordSaveFailure`,
`releaseSessionExpiry`, `discardDraft`), so they are unit-testable without a
DOM. They are exercised in
`xconfess-frontend/app/lib/settings/__tests__/accountSettingsRecovery.test.ts`.

## Failure classification and retry semantics

`classifySaveFailure` maps a normalized `ApiError` to retry and authorization
semantics. Retry is only offered when a retry can actually succeed; nothing
retries automatically.

| HTTP status | Kind | Can retry | Requires re-authorization |
|-------------|------|-----------|---------------------------|
| 401 | `session_expired` | no | yes |
| 403 | `forbidden` | no | no |
| 0, 408, 425, 429, 5xx, unknown | `retryable` | yes | no |
| other 4xx (e.g. 400, 404, 409, 422) | `rejected` | no | no |

Consequences:

- A transient failure (`retryable`) shows an explicit Retry button and keeps
  the draft intact. It is never retried on its own.
- A 401 blocks further saves for that step until the session is revalidated via
  `GET /api/auth/session` ("Check session"). Only after that probe succeeds does
  the step return to an editable state and an explicit retry become possible.
  The unsaved draft is preserved across the whole re-auth window.
- A 403 or other rejected 4xx is not retryable as-is. The user must adjust the
  value or Discard the step; Discard reverts to the server baseline.

## Local draft backup

Unsaved input is written to `localStorage` under a versioned envelope so an
interrupted session (reload, crash, network drop, closed tab) can be resumed.

| Property | Value |
|----------|-------|
| Storage key | `xconfess:accountSettingsDraft` |
| Envelope version | `SETTINGS_DRAFT_VERSION` (currently `1`) |
| Envelope shape | `{ version, updatedAt, activeStep?, steps }` |

Behavior:

- A step's draft is written only while that step is dirty. When no step is
  dirty (all clean or all saved) the key is cleared.
- `activeStep` is stored so the flow resumes where the user left off.
- On load, stored drafts are merged onto freshly loaded server values with
  `mergeDraft`. Only keys that already exist in the server baseline with a
  compatible shape are restored; unknown keys and type-drifted values from
  older sessions are dropped. A merge never invents fields.
- The reader (`readDraftEnvelope`) never throws. Corrupt JSON, a version
  mismatch, structurally invalid `steps`, or unavailable storage all yield
  `null`, and the flow simply starts from server values.
- If the browser rejects the write (quota, private mode), the flow surfaces an
  honest in-app warning instead of pretending the input is backed up.
- Drafts are cleared when the user finishes the flow.

## Kill switch

Local draft persistence can be disabled operationally:

| Variable | Effect |
|----------|--------|
| `NEXT_PUBLIC_SETTINGS_RECOVERY_ENABLED=true` (default) | Drafts restored and written |
| `NEXT_PUBLIC_SETTINGS_RECOVERY_ENABLED=false` | Stored drafts ignored; no writes. In-session editing and per-step state keep working |

See `xconfess-frontend/.env.example`.

## Security and privacy notes

- Drafts contain only the settings values being edited (booleans and time
  strings for these steps). They never contain auth tokens, session cookies, or
  server secrets.
- Drafts are device-local and are not synced or sent anywhere.
- Save requests are made with `credentials: "include"` so the normal
  cookie-based session applies; the recovery layer does not manage tokens.

## Reauthentication risk tiers

Authentication and authorization are enforced by the backend routes; the
frontend prompt is only the accessible way to obtain and attach a proof.
Session possession by itself is not sufficient to modify privacy, recovery,
credential, or account-identity data.

| Tier | Examples | Required authorization |
|------|----------|------------------------|
| Routine settings | Notification preferences and ordinary session actions | Authenticated session |
| Sensitive privacy | Profile discoverability, reply/reaction visibility, data-processing consent | Authenticated session plus a fresh step-up proof |
| Account control | Password changes, TOTP disablement, recovery-code replacement/revocation, email change/rollback | Authenticated session plus a fresh step-up proof; email activation also requires the existing out-of-band email verification |
| Account recovery | Forgot-password request and password reset | Generic reset-request response; reset requires possession of the one-time email token and does not rely on an active session |

Step-up proofs are issued by `POST /auth/step-up` after verifying exactly one
password, TOTP token, or single-use recovery code. They are user-bound and
short-lived (300 seconds by default); clients attach the proof as
`x-step-up-token`. Missing, expired, invalid, or wrong-user proofs are rejected
with stable `AUTH_STEP_UP_*` codes and no sensitive change is applied. The
generic settings endpoint is also step-up protected and only accepts privacy
and notification preference fields; it cannot be used to mutate credential or
identity columns.

Operational setting:

| Variable | Default | Allowed range | Purpose |
|----------|---------|---------------|---------|
| `STEP_UP_PROOF_TTL_SECONDS` | `300` | `60`-`900` | Lifetime of a verified step-up proof |

The privacy screens preserve unsaved changes while the user completes
reauthentication. The prompt is keyboard-accessible, traps focus, exposes
verification errors, and offers password, authenticator, and recovery-code
options. Canceling it does not submit the pending settings.

## Validation

Run the frontend suites that cover this behavior:

```bash
npm run frontend:test
```

Run the backend suite for ownership, step-up, and account-setting enforcement:

```bash
npm run backend:test
```

Relevant specs:

- `xconfess-frontend/app/lib/settings/__tests__/accountSettingsRecovery.test.ts` —
  state machine, failure classification, draft codec, merge safety.
- `xconfess-frontend/tests/settings/account-settings-recovery.spec.tsx` —
  end-to-end flow: edit/save/back-navigation, interrupted-session restore,
  explicit retry, session-expiry revalidation, non-retryable rejection,
  corrupt draft, double-submit guard, load-error retry, and the kill switch.

Type checking (test files are excluded from `tsc`):

```bash
npm run frontend:typecheck
```

## Related code

- `xconfess-frontend/app/lib/settings/accountSettingsRecovery.ts` — owning
  boundary (pure logic).
- `xconfess-frontend/app/lib/settings/useAccountSettingsFlow.ts` — React hook
  binding (hydration, save/retry, navigation, local persistence effect).
- `xconfess-frontend/app/(dashboard)/settings/account/page.tsx` — the wizard UI.
- `xconfess-frontend/app/lib/api/errors.ts` — `normalizeApiError` / `ApiError`.
