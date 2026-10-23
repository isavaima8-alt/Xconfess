import { renderHook, act } from '@testing-library/react';
import { useBlockMute, BLOCK_MUTE_EVENT } from '../useBlockMute';
import apiClient from '@/app/lib/api/client';

jest.mock('@/app/lib/api/client', () => ({
  get: jest.fn(),
  post: jest.fn(),
  delete: jest.fn(),
}));

describe('useBlockMute (#225)', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('initializes with empty lists when storage is clear', () => {
    const { result } = renderHook(() => useBlockMute());
    expect(result.current.blockedUserIds).toEqual([]);
    expect(result.current.mutedUserIds).toEqual([]);
    expect(result.current.getPrecedence(42)).toBe('allow');
  });

  it('correctly evaluates Block > Mute > Allow precedence', () => {
    localStorage.setItem(
      'xconfess_block_mute_preferences',
      JSON.stringify({
        blockedUserIds: [10],
        mutedUserIds: [20],
      }),
    );

    const { result } = renderHook(() => useBlockMute());

    expect(result.current.isBlocked(10)).toBe(true);
    expect(result.current.isMuted(10)).toBe(false);
    expect(result.current.getPrecedence(10)).toBe('block');

    expect(result.current.isBlocked(20)).toBe(false);
    expect(result.current.isMuted(20)).toBe(true);
    expect(result.current.getPrecedence(20)).toBe('mute');

    expect(result.current.isBlocked(30)).toBe(false);
    expect(result.current.isMuted(30)).toBe(false);
    expect(result.current.getPrecedence(30)).toBe('allow');
  });

  it('filters content across surfaces by excluding blocked and muted authors', () => {
    localStorage.setItem(
      'xconfess_block_mute_preferences',
      JSON.stringify({
        blockedUserIds: [1],
        mutedUserIds: [2],
      }),
    );

    const { result } = renderHook(() => useBlockMute());

    const items = [
      { id: 'c1', authorId: 1, text: 'from blocked user' },
      { id: 'c2', authorId: 2, text: 'from muted user' },
      { id: 'c3', authorId: 3, text: 'from normal user' },
      { id: 'c4', text: 'anonymous without authorId' },
    ];

    const filtered = result.current.filterContent(items);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((item) => item.id)).toEqual(['c3', 'c4']);
  });

  it('validates navigation targets (profiles) with 403 semantics for blocked and soft-label for muted', () => {
    localStorage.setItem(
      'xconfess_block_mute_preferences',
      JSON.stringify({
        blockedUserIds: [100],
        mutedUserIds: [200],
      }),
    );

    const { result } = renderHook(() => useBlockMute());

    const blockedTarget = result.current.checkProfileAccess(100);
    expect(blockedTarget.allowed).toBe(false);
    expect(blockedTarget.isMuted).toBe(false);
    expect(blockedTarget.error).toContain('account blocking preferences');

    const mutedTarget = result.current.checkProfileAccess(200);
    expect(mutedTarget.allowed).toBe(true);
    expect(mutedTarget.isMuted).toBe(true);
    expect(mutedTarget.error).toBeUndefined();

    const allowedTarget = result.current.checkProfileAccess(300);
    expect(allowedTarget.allowed).toBe(true);
    expect(allowedTarget.isMuted).toBe(false);
  });

  it('optimistically blocks a user and removes them from mute list', async () => {
    localStorage.setItem(
      'xconfess_block_mute_preferences',
      JSON.stringify({
        blockedUserIds: [],
        mutedUserIds: [5],
      }),
    );

    (apiClient.post as jest.Mock).mockResolvedValue({ data: { success: true } });

    const { result } = renderHook(() => useBlockMute());

    await act(async () => {
      await result.current.blockUser(5);
    });

    expect(result.current.blockedUserIds).toContain(5);
    expect(result.current.mutedUserIds).not.toContain(5);
    expect(result.current.getPrecedence(5)).toBe('block');
    expect(apiClient.post).toHaveBeenCalledWith('/users/5/block');
  });

  it('optimistically unblocks a user', async () => {
    localStorage.setItem(
      'xconfess_block_mute_preferences',
      JSON.stringify({
        blockedUserIds: [7],
        mutedUserIds: [],
      }),
    );

    (apiClient.delete as jest.Mock).mockResolvedValue({ data: { success: true } });

    const { result } = renderHook(() => useBlockMute());

    await act(async () => {
      await result.current.unblockUser(7);
    });

    expect(result.current.blockedUserIds).not.toContain(7);
    expect(result.current.getPrecedence(7)).toBe('allow');
    expect(apiClient.delete).toHaveBeenCalledWith('/users/7/block');
  });

  it('optimistically mutes and unmutes a user', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({ data: { success: true } });
    (apiClient.delete as jest.Mock).mockResolvedValue({ data: { success: true } });

    const { result } = renderHook(() => useBlockMute());

    await act(async () => {
      await result.current.muteUser(9);
    });
    expect(result.current.mutedUserIds).toContain(9);
    expect(result.current.getPrecedence(9)).toBe('mute');

    await act(async () => {
      await result.current.unmuteUser(9);
    });
    expect(result.current.mutedUserIds).not.toContain(9);
    expect(result.current.getPrecedence(9)).toBe('allow');
  });

  it('synchronizes state reactively on custom event to avoid stale client state', () => {
    const { result } = renderHook(() => useBlockMute());

    expect(result.current.blockedUserIds).toEqual([]);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(BLOCK_MUTE_EVENT, {
          detail: {
            blockedUserIds: [99],
            mutedUserIds: [88],
          },
        }),
      );
    });

    expect(result.current.blockedUserIds).toEqual([99]);
    expect(result.current.mutedUserIds).toEqual([88]);
    expect(result.current.getPrecedence(99)).toBe('block');
    expect(result.current.getPrecedence(88)).toBe('mute');
  });
});
