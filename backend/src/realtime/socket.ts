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

    // Reconnect cleanup: remove stale presence/typing state on disconnect.
    socket.on('disconnect', () => {
      logger.debug({ userId }, 'realtime disconnect, cleaning presence/typing');
      cleanupUser(io, userId);
    });
  });

  return io;
}
