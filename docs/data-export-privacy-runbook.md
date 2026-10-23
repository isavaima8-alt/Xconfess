# Data Export Privacy & Legal Response Runbook

This runbook documents how the team handles user data export requests during normal operations and incident response. It ensures privacy requests are handled consistently, securely, and defensibly, with clear guidelines for engineering, support, and compliance teams.

## 1. Normal Operations (Happy Path)

### Request Intake
- **Rate Limiting:** Users can request exactly **one** export every 7 days.
- **State Machine:** Requests follow `PENDING` -> `PROCESSING` -> `READY` (or `FAILED`), with `CANCELLED` used when the owner cancels or their privacy state changes. Ready artifacts later become `EXPIRED` at the retention boundary.
- **Initial Audit Event:** Upon request creation, the `auditLogService` logs a `request_created` event binding the user ID to the request ID.

### Generation & Processing
- The background `export-queue` (Bull) picks up the `PENDING` job, marking it `PROCESSING`.
- Service compiles the user's confessions, messages, reactions, etc., and generates CSVs or zipped chunks.
- Upon completion, the status changes to `READY`, and a `generation_completed` audit event is logged by the system.
- **Snapshot consistency:** The snapshot is bound to a SHA-256 fingerprint of the user's privacy-relevant state at worker pickup. The worker compares it after compilation and chunk writes and only publishes while the request remains `PROCESSING` with that same fingerprint. Any account deletion, deactivation, reactivation, or privacy-settings update cancels the user's pending/processing/ready exports and removes stored files/chunks.

### Delivery & Expiry
- **Secure Download Links:** The system generates signed, expiring URLs (`generateSignedDownloadUrl`) using HMAC SHA-256 for the delivery of the export payload.
- **Delivery authorization:** Every link issuance and download re-checks request ownership, current user existence, processing consent, and snapshot fingerprint. Missing accounts return not found; withdrawn consent returns forbidden; stale snapshots return gone and their artifacts are purged. Download authorization runs before consuming the one-time token.
- **Link Expiration:** Download links are strictly valid for **24 hours** from generation. 
- **Time Window Expiration:** Once the 24-hour window passes, the link expires and the request state is treated as `EXPIRED`. Users must wait until the original 7-day rate limit ends to request a new export link, to mitigate ongoing exposure risks.
- **Download Audit:** Every time the payload is fetched, a `downloaded` event is generated for tracking access.

---

## 2. Incident Response

### Rollout
Apply migration `AddExportPrivacySnapshotVersion20261021000001` before deploying the worker/API code. Existing exports have no fingerprint and are intentionally rejected and purged on the next link or download attempt; users can request a fresh export subject to the existing seven-day rate limit.

If an operational anomaly or security violation occurs regarding an export, follow the steps below.

### Scenario A: Failed Exports (Processing Error)
**Detection:** The user's job enters the `FAILED` state.
**Action Plan (Support / Engineering):**
1. Check the `lastFailureReason` on the request item in the database or admin dashboard. 
2. Verify if the failure is temporary (e.g., database timeout) or systemic (e.g., malformed user data crashing the compiler).
3. If systemic, Engineering must patch the export generation service.
4. Support can manually clear the rate limit by deleting the failed `ExportRequest` record, allowing the user to request a fresh export immediately.

### Scenario B: Leaked Links (Security Incident)
**Detection:** A user reports their signed download URL was leaked, or threat intel flags the link on a public venue.
**Action Plan (Security / Engineering):**
1. **Immediate Revocation (Targeted):** The leaked link cannot be natively revoked before its 24-hr expiry unless the underlying `appSecret` or request ID is invalidated. Immediately delete the `ExportRequest` and associated `ExportChunk` items from the database. This causes future requests to return `404 Not Found`.
2. **Review Audit Logs:** Query `auditLogService.logExportLifecycleEvent` for action `downloaded` associated with the request ID. Determine if the payload was successfully downloaded by an unauthorized actor.
3. **Escalation:** If evidence of unauthorized download exists, escalate to the Legal & Privacy team for formal breach notification procedures.

### Scenario C: Mistaken Account Matching (Privacy Incident)
**Detection:** A user reports that their downloaded export contains messages or data belonging to someone else.
**Action Plan (Privacy / Engineering):**
1. **Containment:** Immediately delete the affected `ExportRequest` and its chunks from the database/S3 to invalidate the link.
2. **Account Lock:** Temporarily lock the affected account configurations to prevent further generation while investigating the cross-contamination.
3. **Investigation:** Engineering must investigate the TypeORM queries in `data-export.service.ts` to identify the authorization leak boundary.
4. **Notification:** Legal & Privacy team must be engaged immediately. Identify the true owner of the erroneously exposed data and follow regulatory notification requirements (e.g., GDPR 72-hour notification).
5. **Recovery:** Once fixed, offer the users a managed, verified export run by Support.

---

## 3. Compliance and Audit Evidence

During a compliance review or regulatory inquiry, the engineering team must provide the following evidence from the `auditLogService`:

- **Who & When (Intake):** Provide logs with action `request_created` filtering by timestamp and actor ID.
- **Integrity (Processing):** Provide `generation_completed` logs showing successful compilation by the system.
- **Access Logs (Delivery):** Provide `link_refreshed` and `downloaded` logs showing exactly when, and potentially from what IP/agent (if stored in metadata), the data was downloaded.

*All Support and Engineering personnel must rely on these immutable audit events over user claims when verifying account data timelines.*


