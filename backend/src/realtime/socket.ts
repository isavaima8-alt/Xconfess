import type { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { verifyToken } from '../auth/jwt';
import { logger } from '../utils/logger';

// Opt-in presence/typing sharing. Users must explicitly enable sharing before
// any presence or typing signal is broadcast on their behalf.
const presenceOptIn = new Map<string, boolean>();

// Coarse timing: activity signals are throttled to a coarse bucket so that
// fine-grained behavioral patterns cannot be inferred from event timing.
const COARSE_BUCKET_MS = 15_000;
const lastSignalAt = new Map<string, number>();

// Server-side expiry: presence and typing state are dropped if not refreshed.
const PRESENCE_TTL_MS = 60_000;
const TYPING_TTL_MS = 10_000;
const presenceExpiry = new Map<string, NodeJS.Timeout>();
const typingExpiry = new Map<string, NodeJS.Timeout>();

// Personalized ranking explanations. Explanations are derived only from the
// requesting user's own signals (never other users' private activity) and are
// expressed with a stable, privacy-safe reason-code vocabulary.
const RANKING_REASON_CODES = [
  'followed_author',
  'similar_to_your_interests',
  'recently_engaged_topic',
  'trending_in_your_network',
  'chronological_fallback',
] as const;
type RankingReasonCode = (typeof RANKING_REASON_CODES)[number];

const RANKING_REASON_LABELS: Record<RankingReasonCode, string> = {
  followed_author: 'From an author you follow',
  similar_to_your_interests: 'Similar to topics you engage with',
  recently_engaged_topic: 'Related to a topic you recently engaged with',
  trending_in_your_network: 'Trending among people you follow',
  chronological_fallback: 'Shown in chronological order',
};

// Per-user personalization controls. Users can disable personalization or mute
// individual signals; muted signals are excluded from explanations.
const personalizationDisabled = new Map<string, boolean>();
const mutedSignals = new Map<string, Set<RankingReasonCode>>();

// Staged rollout for ranking configuration. Each configuration is versioned so
// a change is identifiable and reversible. A candidate is compared against the
// current configuration on an isolated fixture set before it can be promoted;
// rollout and rollback are gated on explicit, observable criteria.
interface RankingConfig {
  version: string;
  weights: Record<RankingReasonCode, number>;
}

interface RankingFixture {
  id: string;
  codes: RankingReasonCode[];
}

// Isolated fixture set: never derived from live user activity.
const RANKING_FIXTURES: RankingFixture[] = [
  { id: 'fx-follow', codes: ['followed_author'] },
  { id: 'fx-interest', codes: ['similar_to_your_interests'] },
  { id: 'fx-topic', codes: ['recently_engaged_topic'] },
  { id: 'fx-network', codes: ['trending_in_your_network'] },
  { id: 'fx-fallback', codes: ['chronological_fallback'] },
];

// Bounded comparison: candidate must stay within this relative delta of the
// current configuration on the fixture set, otherwise rollout is rejected.
const MAX_RELATIVE_DELTA = 0.25;

const DEFAULT_RANKING_CONFIG: RankingConfig = {
  version: 'v1',
  weights: {
    followed_author: 1,
    similar_to_your_interests: 0.8,
    recently_engaged_topic: 0.6,
    trending_in_your_network: 0.5,
    chronological_fallback: 0.1,
  },
};

let currentRankingConfig: RankingConfig = DEFAULT_RANKING_CONFIG;
let pendingRankingConfig: RankingConfig | null = null;
let lastRollout: { from: string; to: string; at: number } | null = null;
let lastRollback: { from: string; to: string; at: number } | null = null;

function scoreConfig(config: RankingConfig): number {
  let total = 0;
  for (const fixture of RANKING_FIXTURES) {
    for (const code of fixture.codes) total += config.weights[code] ?? 0;
  }
  return total;
}

function isRankingConfig(value: unknown): value is RankingConfig {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { version?: unknown; weights?: unknown };
  if (typeof candidate.version !== 'string' || candidate.version.length === 0) return false;
  if (!candidate.weights || typeof candidate.weights !== 'object') return false;
  const weights = candidate.weights as Record<string, unknown>;
  return RANKING_REASON_CODES.every((code) => typeof weights[code] === 'number' && Number.isFinite(weights[code]));
}

function compareOnFixtures(candidate: RankingConfig): {
  currentScore: number;
  candidateScore: number;
  relativeDelta: number;
  withinBounds: boolean;
} {
  const currentScore = scoreConfig(currentRankingConfig);
  const candidateScore = scoreConfig(candidate);
  const relativeDelta = currentScore === 0 ? 0 : Math.abs(candidateScore - currentScore) / currentScore;
  return { currentScore, candidateScore, relativeDelta, withinBounds: relativeDelta <= MAX_RELATIVE_DELTA };
}

function isRankingReasonCode(value: unknown): value is RankingReasonCode {
  return typeof value === 'string' && (RANKING_REASON_CODES as readonly string[]).includes(value);
}

function buildExplanation(userId: string, codes: unknown): {
  personalized: boolean;
  reasons: Array<{ code: RankingReasonCode; label: string }>;
} {
  const disabled = personalizationDisabled.get(userId) === true;
  const muted = mutedSignals.get(userId) ?? new Set<RankingReasonCode>();
  const safeCodes = Array.isArray(codes) ? codes.filter(isRankingReasonCode) : [];
  const reasons = disabled
    ? [{ code: 'chronological_fallback' as RankingReasonCode, label: RANKING_REASON_LABELS.chronological_fallback }]
    : safeCodes
        .filter((code) => !muted.has(code))
        .map((code) => ({ code, label: RANKING_REASON_LABELS[code] }));
  return { personalized: !disabled, reasons };
}

function clearTimers(userId: string): void {
  const p = presenceExpiry.get(userId);
  if (p) clearTimeout(p);
  presenceExpiry.delete(userId);
  const t = typingExpiry.get(userId);
  if (t) clearTimeout(t);
  typingExpiry.delete(userId);
}

function cleanupUser(io: Server, userId: string): void {
  clearTimers(userId);
  presenceOptIn.delete(userId);
  lastSignalAt.delete(userId);
  io.emit('presence:update', { userId, status: 'offline' });
  io.emit('typing:update', { userId, isTyping: false });
}

function withinCoarseBucket(userId: string): boolean {
  const now = Date.now();
  const last = lastSignalAt.get(userId) ?? 0;
  if (now - last < COARSE_BUCKET_MS) return false;
  lastSignalAt.set(userId, now);
  return true;
}

export function attachRealtime(server: HttpServer): Server {
  const io = new Server(server, {
    cors: { origin: process.env.CORS_ORIGIN ?? '*', credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('unauthorized'));
    try {
      const payload = verifyToken(token);
      (socket.data as { userId?: string }).userId = payload.sub;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket.data as { userId?: string }).userId;
    if (!userId) {
      socket.disconnect(true);
      return;
    }

    // Explicit opt-in required before any presence/typing signal is shared.
    socket.on('presence:opt-in', (enabled: boolean) => {
      presenceOptIn.set(userId, enabled === true);
      if (enabled !== true) {
        clearTimers(userId);
        io.emit('presence:update', { userId, status: 'offline' });
        io.emit('typing:update', { userId, isTyping: false });
      }
    });

    socket.on('presence:heartbeat', () => {
      if (presenceOptIn.get(userId) !== true) return;
      if (!withinCoarseBucket(userId)) return;
      io.emit('presence:update', { userId, status: 'online' });
      const existing = presenceExpiry.get(userId);
      if (existing) clearTimeout(existing);
      presenceExpiry.set(
        userId,
        setTimeout(() => {
          presenceExpiry.delete(userId);
          io.emit('presence:update', { userId, status: 'offline' });
        }, PRESENCE_TTL_MS),
      );
    });

    socket.on('typing:start', () => {
      if (presenceOptIn.get(userId) !== true) return;
      if (!withinCoarseBucket(userId)) return;
      io.emit('typing:update', { userId, isTyping: true });
      const existing = typingExpiry.get(userId);
      if (existing) clearTimeout(existing);
      typingExpiry.set(
        userId,
        setTimeout(() => {
          typingExpiry.delete(userId);
          io.emit('typing:update', { userId, isTyping: false });
        }, TYPING_TTL_MS),
      );
    });

    socket.on('typing:stop', () => {
      if (presenceOptIn.get(userId) !== true) return;
      const existing = typingExpiry.get(userId);
      if (existing) clearTimeout(existing);
      typingExpiry.delete(userId);
      io.emit('typing:update', { userId, isTyping: false });
    });

    // Ranking explanation request. Only the authenticated user's own signals
    // are used; unknown reason codes are dropped and muted signals excluded.
    socket.on('ranking:explain', (payload: { itemId?: string; codes?: unknown }, ack?: unknown) => {
      const respond = typeof ack === 'function' ? (ack as (res: unknown) => void) : undefined;
      if (!payload || typeof payload.itemId !== 'string') {
        respond?.({ ok: false, error: 'invalid_request' });
        return;
      }
      const explanation = buildExplanation(userId, payload.codes);
      respond?.({ ok: true, itemId: payload.itemId, ...explanation });
    });

    // Actionable personalization controls scoped to the current user.
    socket.on('ranking:set-personalization', (enabled: boolean, ack?: unknown) => {
      const respond = typeof ack === 'function' ? (ack as (res: unknown) => void) : undefined;
      personalizationDisabled.set(userId, enabled !== true);
      respond?.({ ok: true, personalized: enabled === true });
    });

    socket.on('ranking:mute-signal', (code: unknown, ack?: unknown) => {
      const respond = typeof ack === 'function' ? (ack as (res: unknown) => void) : undefined;
      if (!isRankingReasonCode(code)) {
        respond?.({ ok: false, error: 'unknown_signal' });
        return;
      }
      const set = mutedSignals.get(userId) ?? new Set<RankingReasonCode>();
      set.add(code);
      mutedSignals.set(userId, set);
      respond?.({ ok: true, muted: Array.from(set) });
    });

    socket.on('ranking:reset-personalization', (ack?: unknown) => {
      const respond = typeof ack === 'function' ? (ack as (res: unknown) => void) : undefined;
      personalizationDisabled.delete(userId);
      mutedSignals.delete(userId);
      respond?.({ ok: true, personalized: true, muted: [] });
    });

    // Staged rollout: stage a candidate configuration and compare it against the
    // current configuration on the isolated fixture set. Rejects invalid or
    // out-of-bounds candidates so a broad change cannot be applied blindly.
    socket.on('ranking:stage-config', (candidate: unknown, ack?: unknown) => {
      const respond = typeof ack === 'function' ? (ack as (res: unknown) => void) : undefined;
      if (!isRankingConfig(candidate)) {
        respond?.({ ok: false, error: 'invalid_config' });
        return;
      }
      if (candidate.version === currentRankingConfig.version) {
        respond?.({ ok: false, error: 'version_conflict' });
        return;
      }
      const comparison = compareOnFixtures(candidate);
      if (!comparison.withinBounds) {
        respond?.({ ok: false, error: 'out_of_bounds', ...comparison });
        return;
      }
      pendingRankingConfig = candidate;
      respond?.({ ok: true, currentVersion: currentRankingConfig.version, candidateVersion: candidate.version, ...comparison });
    });

    // Promote the staged candidate. Requires a staged candidate that still
    // passes the bounded comparison; records an observable rollout event.
    socket.on('ranking:rollout', (ack?: unknown) => {
      const respond = typeof ack === 'function' ? (ack as (res: unknown) => void) : undefined;
      if (!pendingRankingConfig) {
        respond?.({ ok: false, error: 'no_staged_config' });
        return;
      }
      const comparison = compareOnFixtures(pendingRankingConfig);
      if (!comparison.withinBounds) {
        respond?.({ ok: false, error: 'out_of_bounds', ...comparison });
        return;
      }
      const from = currentRankingConfig.version;
      currentRankingConfig = pendingRankingConfig;
      pendingRankingConfig = null;
      lastRollout = { from, to: currentRankingConfig.version, at: Date.now() };
      logger.info({ from, to: currentRankingConfig.version }, 'ranking config rolled out');
      respond?.({ ok: true, version: currentRankingConfig.version, rollout: lastRollout });
    });

    // Fast rollback path: restore the previous configuration version. Fails
    // explicitly when there is no rollout to roll back.
    socket.on('ranking:rollback', (ack?: unknown) => {
      const respond = typeof ack === 'function' ? (ack as (res: unknown) => void) : undefined;
      if (!lastRollout) {
        respond?.({ ok: false, error: 'nothing_to_rollback' });
        return;
      }
      const from = currentRankingConfig.version;
      currentRankingConfig = { ...DEFAULT_RANKING_CONFIG, version: lastRollout.from };
      pendingRankingConfig = null;
      lastRollback = { from, to: currentRankingConfig.version, at: Date.now() };
      lastRollout = null;
      logger.info({ from, to: currentRankingConfig.version }, 'ranking config rolled back');
      respond?.({ ok: true, version: currentRankingConfig.version, rollback: lastRollback });
    });

    // Observable rollout/rollback state for operators.
    socket.on('ranking:config-status', (ack?: unknown) => {
      const respond = typeof ack === 'function' ? (ack as (res: unknown) => void) : undefined;
      respond?.({
        ok: true,
        currentVersion: currentRankingConfig.version,
        pendingVersion: pendingRankingConfig?.version ?? null,
        lastRollout,
        lastRollback,
      });
    });

    // Reconnect cleanup: remove stale presence/typing state on disconnect.
    socket.on('disconnect', () => {
      logger.debug({ userId }, 'realtime disconnect');
      cleanupUser(io, userId);
    });
  });

  return io;
}
