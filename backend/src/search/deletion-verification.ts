/**
 * Per-record search-index deletion verification.
 *
 * A queued deletion event does not prove that every index or replica stopped
 * returning the removed content. This module tracks completion per index using
 * opaque identifiers (never raw deleted content) and exposes a bounded
 * verification command that reports status without printing deleted content.
 */

export type DeletionTargetStatus = "pending" | "completed" | "failed";

export interface DeletionTargetState {
  /** Opaque index/replica identifier. */
  indexId: string;
  status: DeletionTargetStatus;
  attempts: number;
  lastError?: string;
}

export interface DeletionRecord {
  /** Opaque record identifier — never the deleted content itself. */
  recordId: string;
  targets: Record<string, DeletionTargetState>;
  createdAt: number;
  updatedAt: number;
}

export interface DeletionVerifierOptions {
  /** Maximum retry attempts per index before marking it failed. */
  maxAttempts?: number;
  /** Maximum number of records a verification command will inspect. */
  maxRecords?: number;
  /** Clock injection for deterministic tests. */
  now?: () => number;
}

export interface DeletionVerificationReport {
  recordId: string;
  complete: boolean;
  targets: Array<{ indexId: string; status: DeletionTargetStatus; attempts: number }>;
}

export interface DeletionVerificationSummary {
  inspected: number;
  complete: number;
  incomplete: number;
  failed: number;
  truncated: boolean;
  records: DeletionVerificationReport[];
}

export class DeletionVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeletionVerificationError";
  }
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_RECORDS = 100;

/**
 * Validates that an identifier is opaque and safe to log. Rejects empty values
 * and anything that looks like it could carry deleted content (whitespace or
 * overly long payloads).
 */
function assertOpaqueId(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new DeletionVerificationError(`${label} must be a non-empty string`);
  }
  if (value.length > 128 || /\s/.test(value)) {
    throw new DeletionVerificationError(
      `${label} must be an opaque identifier (no whitespace, <=128 chars)`,
    );
  }
}

/**
 * Tracks deletion completion per index for a set of records. All identifiers
 * are opaque; the verifier never stores or emits deleted content.
 */
export class DeletionVerifier {
  private readonly records = new Map<string, DeletionRecord>();
  private readonly maxAttempts: number;
  private readonly maxRecords: number;
  private readonly now: () => number;

  constructor(options: DeletionVerifierOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Registers a deletion event for a record across the given index ids.
   * Idempotent: re-registering an existing record does not reset progress.
   */
  register(recordId: string, indexIds: string[]): DeletionRecord {
    assertOpaqueId(recordId, "recordId");
    if (!Array.isArray(indexIds) || indexIds.length === 0) {
      throw new DeletionVerificationError("indexIds must be a non-empty array");
    }
    for (const indexId of indexIds) {
      assertOpaqueId(indexId, "indexId");
    }

    const existing = this.records.get(recordId);
    if (existing) {
      for (const indexId of indexIds) {
        if (!existing.targets[indexId]) {
          existing.targets[indexId] = {
            indexId,
            status: "pending",
            attempts: 0,
          };
        }
      }
      existing.updatedAt = this.now();
      return existing;
    }

    const timestamp = this.now();
    const targets: Record<string, DeletionTargetState> = {};
    for (const indexId of indexIds) {
      targets[indexId] = { indexId, status: "pending", attempts: 0 };
    }
    const record: DeletionRecord = {
      recordId,
      targets,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.records.set(recordId, record);
    return record;
  }

  /**
   * Marks a single index deletion as completed. Returns false when the record
   * or index is unknown so callers can surface a defined failure.
   */
  markCompleted(recordId: string, indexId: string): boolean {
    const target = this.records.get(recordId)?.targets[indexId];
    if (!target) {
      return false;
    }
    target.status = "completed";
    target.lastError = undefined;
    this.records.get(recordId)!.updatedAt = this.now();
    return true;
  }

  /**
   * Records a failed attempt for an index. Retries are bounded by maxAttempts;
   * once exhausted the target is marked failed and will not be retried again.
   */
  markFailed(recordId: string, indexId: string, error?: string): DeletionTargetStatus {
    const record = this.records.get(recordId);
    const target = record?.targets[indexId];
    if (!record || !target) {
      throw new DeletionVerificationError(
        `unknown deletion target for record ${recordId} index ${indexId}`,
      );
    }
    target.attempts += 1;
    target.lastError = error;
    target.status = target.attempts >= this.maxAttempts ? "failed" : "pending";
    record.updatedAt = this.now();
    return target.status;
  }

  /**
   * Returns the index ids that still need a deletion attempt (pending only).
   * Failed targets are excluded so retries never loop indefinitely.
   */
  pendingTargets(recordId: string): string[] {
    const record = this.records.get(recordId);
    if (!record) {
      return [];
    }
    return Object.values(record.targets)
      .filter((t) => t.status === "pending")
      .map((t) => t.indexId);
  }

  /**
   * Bounded verification command. Inspects at most maxRecords records and
   * reports completion status per index without printing deleted content.
   */
  verify(recordIds?: string[]): DeletionVerificationSummary {
    const ids = recordIds ?? Array.from(this.records.keys());
    const truncated = ids.length > this.maxRecords;
    const inspectedIds = ids.slice(0, this.maxRecords);

    const reports: DeletionVerificationReport[] = [];
    let complete = 0;
    let incomplete = 0;
    let failed = 0;

    for (const recordId of inspectedIds) {
      const record = this.records.get(recordId);
      if (!record) {
        continue;
      }
      const targets = Object.values(record.targets).map((t) => ({
        indexId: t.indexId,
        status: t.status,
        attempts: t.attempts,
      }));
      const isComplete = targets.length > 0 && targets.every((t) => t.status === "completed");
      const hasFailed = targets.some((t) => t.status === "failed");
      if (isComplete) {
        complete += 1;
      } else if (hasFailed) {
        failed += 1;
      } else {
        incomplete += 1;
      }
      reports.push({ recordId, complete: isComplete, targets });
    }

    return {
      inspected: reports.length,
      complete,
      incomplete,
      failed,
      truncated,
      records: reports,
    };
  }
}
