import { useState, useEffect, useCallback } from 'react';
import apiClient from '@/app/lib/api/client';

export type RelationshipPrecedence = 'block' | 'mute' | 'allow';

export interface BlockMuteState {
  blockedUserIds: number[];
  mutedUserIds: number[];
  isLoading: boolean;
  error: string | null;
}

const STORAGE_KEY = 'xconfess_block_mute_preferences';
export const BLOCK_MUTE_EVENT = 'xconfess:block-mute-changed';

/**
 * Shared in-memory cache to synchronize client state across surfaces without
 * waiting for round-trips.
 */
let memoryCache: { blockedUserIds: number[]; mutedUserIds: number[] } = {
  blockedUserIds: [],
  mutedUserIds: [],
};

const readStoredPreferences = () => {
  if (typeof window === 'undefined') return memoryCache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      memoryCache = {
        blockedUserIds: Array.isArray(parsed.blockedUserIds) ? parsed.blockedUserIds : [],
        mutedUserIds: Array.isArray(parsed.mutedUserIds) ? parsed.mutedUserIds : [],
      };
    }
  } catch {
    // Fallback to in-memory
  }
  return memoryCache;
};

const writeStoredPreferences = (data: { blockedUserIds: number[]; mutedUserIds: number[] }) => {
  memoryCache = data;
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      window.dispatchEvent(
        new CustomEvent(BLOCK_MUTE_EVENT, { detail: data }),
      );
    } catch {
      // Ignore storage write errors
    }
  }
};

export const useBlockMute = () => {
  const [state, setState] = useState<BlockMuteState>(() => {
    const cached = readStoredPreferences();
    return {
      blockedUserIds: cached.blockedUserIds,
      mutedUserIds: cached.mutedUserIds,
      isLoading: false,
      error: null,
    };
  });

  // Listen to cross-component and cross-tab preference changes to prevent stale client state
  useEffect(() => {
    const handleSync = (event: Event) => {
      const customEvent = event as CustomEvent<{
        blockedUserIds: number[];
        mutedUserIds: number[];
      }>;
      if (customEvent.detail) {
        setState((prev) => ({
          ...prev,
          blockedUserIds: customEvent.detail.blockedUserIds,
          mutedUserIds: customEvent.detail.mutedUserIds,
        }));
      } else {
        const stored = readStoredPreferences();
        setState((prev) => ({
          ...prev,
          blockedUserIds: stored.blockedUserIds,
          mutedUserIds: stored.mutedUserIds,
        }));
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        handleSync(e);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(BLOCK_MUTE_EVENT, handleSync);
      window.addEventListener('storage', handleStorage);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener(BLOCK_MUTE_EVENT, handleSync);
        window.removeEventListener('storage', handleStorage);
      }
    };
  }, []);

  const refreshPreferences = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      const response = await apiClient.get('/users/me/blocks-mutes');
      const data = {
        blockedUserIds: response.data.blockedUserIds || [],
        mutedUserIds: response.data.mutedUserIds || [],
      };
      writeStoredPreferences(data);
      setState({
        blockedUserIds: data.blockedUserIds,
        mutedUserIds: data.mutedUserIds,
        isLoading: false,
        error: null,
      });
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err.response?.data?.message || err.message || 'Failed to fetch preferences',
      }));
    }
  }, []);

  const isBlocked = useCallback(
    (targetUserId: number): boolean => {
      return state.blockedUserIds.includes(targetUserId);
    },
    [state.blockedUserIds],
  );

  const isMuted = useCallback(
    (targetUserId: number): boolean => {
      return state.mutedUserIds.includes(targetUserId);
    },
    [state.mutedUserIds],
  );

  /**
   * Precedence: Block > Mute > Allow
   */
  const getPrecedence = useCallback(
    (targetUserId: number): RelationshipPrecedence => {
      if (isBlocked(targetUserId)) return 'block';
      if (isMuted(targetUserId)) return 'mute';
      return 'allow';
    },
    [isBlocked, isMuted],
  );

  const blockUser = useCallback(
    async (targetUserId: number) => {
      // Optimistic update
      const updatedBlocked = Array.from(new Set([...state.blockedUserIds, targetUserId]));
      const updatedMuted = state.mutedUserIds.filter((id) => id !== targetUserId);
      const optimisticData = {
        blockedUserIds: updatedBlocked,
        mutedUserIds: updatedMuted,
      };
      writeStoredPreferences(optimisticData);
      setState((prev) => ({
        ...prev,
        ...optimisticData,
      }));

      try {
        await apiClient.post(`/users/${targetUserId}/block`);
      } catch (err: any) {
        // Rollback on failure
        refreshPreferences();
        throw err;
      }
    },
    [state.blockedUserIds, state.mutedUserIds, refreshPreferences],
  );

  const unblockUser = useCallback(
    async (targetUserId: number) => {
      // Optimistic update
      const updatedBlocked = state.blockedUserIds.filter((id) => id !== targetUserId);
      const optimisticData = {
        blockedUserIds: updatedBlocked,
        mutedUserIds: state.mutedUserIds,
      };
      writeStoredPreferences(optimisticData);
      setState((prev) => ({
        ...prev,
        ...optimisticData,
      }));

      try {
        await apiClient.delete(`/users/${targetUserId}/block`);
      } catch (err: any) {
        refreshPreferences();
        throw err;
      }
    },
    [state.blockedUserIds, state.mutedUserIds, refreshPreferences],
  );

  const muteUser = useCallback(
    async (targetUserId: number) => {
      const updatedMuted = Array.from(new Set([...state.mutedUserIds, targetUserId]));
      const optimisticData = {
        blockedUserIds: state.blockedUserIds,
        mutedUserIds: updatedMuted,
      };
      writeStoredPreferences(optimisticData);
      setState((prev) => ({
        ...prev,
        ...optimisticData,
      }));

      try {
        await apiClient.post(`/users/${targetUserId}/mute`);
      } catch (err: any) {
        refreshPreferences();
        throw err;
      }
    },
    [state.blockedUserIds, state.mutedUserIds, refreshPreferences],
  );

  const unmuteUser = useCallback(
    async (targetUserId: number) => {
      const updatedMuted = state.mutedUserIds.filter((id) => id !== targetUserId);
      const optimisticData = {
        blockedUserIds: state.blockedUserIds,
        mutedUserIds: updatedMuted,
      };
      writeStoredPreferences(optimisticData);
      setState((prev) => ({
        ...prev,
        ...optimisticData,
      }));

      try {
        await apiClient.delete(`/users/${targetUserId}/mute`);
      } catch (err: any) {
        refreshPreferences();
        throw err;
      }
    },
    [state.blockedUserIds, state.mutedUserIds, refreshPreferences],
  );

  /**
   * Filter content items on feeds, search results, or notifications according
   * to block and mute precedence.
   */
  const filterContent = useCallback(
    <T extends { authorId?: number; userId?: number; senderId?: number }>(
      items: T[],
    ): T[] => {
      return items.filter((item) => {
        const id = item.authorId ?? item.userId ?? item.senderId;
        if (id === undefined || id === null) return true;
        const precedence = getPrecedence(Number(id));
        return precedence === 'allow';
      });
    },
    [getPrecedence],
  );

  /**
   * Validate navigation targets against block and mute precedence.
   * If blocked: access is denied (403 semantics).
   * If muted: access is allowed, but marked as isMuted: true.
   */
  const checkProfileAccess = useCallback(
    (targetUserId: number): { allowed: boolean; isMuted: boolean; error?: string } => {
      const precedence = getPrecedence(targetUserId);
      if (precedence === 'block') {
        return {
          allowed: false,
          isMuted: false,
          error: 'This profile is unavailable because of account blocking preferences.',
        };
      }
      if (precedence === 'mute') {
        return {
          allowed: true,
          isMuted: true,
        };
      }
      return {
        allowed: true,
        isMuted: false,
      };
    },
    [getPrecedence],
  );

  return {
    blockedUserIds: state.blockedUserIds,
    mutedUserIds: state.mutedUserIds,
    isLoading: state.isLoading,
    error: state.error,
    isBlocked,
    isMuted,
    getPrecedence,
    blockUser,
    unblockUser,
    muteUser,
    unmuteUser,
    filterContent,
    checkProfileAccess,
    refreshPreferences,
  };
};
