import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { UserService } from './user.service';
import { User } from './entities/user.entity';
import { EmailService } from '../email/email.service';

describe('UserService - Block & Mute Functionality (#225)', () => {
  let service: UserService;
  let mockUserRepository: any;
  let mockCacheManager: any;

  const createMockUser = (
    id: number,
    username: string,
    blockedUserIds: number[] = [],
    mutedUserIds: number[] = [],
  ) => {
    const user = new User();
    user.id = id;
    user.username = username;
    user.createdAt = new Date('2026-01-01');
    user.privacySettings = {
      isDiscoverable: true,
      canReceiveReplies: true,
      showReactions: true,
      dataProcessingConsent: true,
      blockedUserIds,
      mutedUserIds,
    };
    return user;
  };

  beforeEach(async () => {
    mockUserRepository = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((user) => Promise.resolve(user)),
      manager: {
        query: jest.fn().mockResolvedValue([]),
      },
    };

    mockCacheManager = {
      del: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: EmailService,
          useValue: {},
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test-aes-key-for-confessions'),
          },
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  describe('Precedence rules (Block > Mute > Allow)', () => {
    it('evaluates precedence correctly on User entity', () => {
      const user = createMockUser(1, 'alice', [2], [3]);
      expect(user.getRelationshipPrecedence(2)).toBe('block');
      expect(user.getRelationshipPrecedence(3)).toBe('mute');
      expect(user.getRelationshipPrecedence(4)).toBe('allow');

      // If user is present in both lists, Block has precedence
      const doubleUser = createMockUser(1, 'alice', [5], [5]);
      expect(doubleUser.getRelationshipPrecedence(5)).toBe('block');
    });
  });

  describe('Block user operations', () => {
    it('rejects self-blocking with BadRequestException', async () => {
      await expect(service.blockUser(1, 1)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when target user does not exist', async () => {
      mockUserRepository.findOne.mockImplementation(({ where }: any) => {
        if (where.id === 1) return Promise.resolve(createMockUser(1, 'alice'));
        return Promise.resolve(null);
      });

      await expect(service.blockUser(1, 999)).rejects.toThrow(NotFoundException);
    });

    it('successfully blocks a target user and evicts from mute list', async () => {
      const user1 = createMockUser(1, 'alice', [], [2]);
      const user2 = createMockUser(2, 'bob');

      mockUserRepository.findOne.mockImplementation(({ where }: any) => {
        if (where.id === 1) return Promise.resolve(user1);
        if (where.id === 2) return Promise.resolve(user2);
        return Promise.resolve(null);
      });

      const result = await service.blockUser(1, 2);

      expect(result.success).toBe(true);
      expect(result.precedence).toBe('block');
      expect(result.blockedUserIds).toContain(2);
      expect(user1.getMutedUserIds()).not.toContain(2);
      expect(mockCacheManager.del).toHaveBeenCalled();
    });

    it('successfully unblocks a target user', async () => {
      const user1 = createMockUser(1, 'alice', [2]);

      mockUserRepository.findOne.mockImplementation(({ where }: any) => {
        if (where.id === 1) return Promise.resolve(user1);
        return Promise.resolve(null);
      });

      const result = await service.unblockUser(1, 2);

      expect(result.success).toBe(true);
      expect(result.precedence).toBe('allow');
      expect(result.blockedUserIds).not.toContain(2);
      expect(mockCacheManager.del).toHaveBeenCalled();
    });
  });

  describe('Mute user operations', () => {
    it('rejects self-muting with BadRequestException', async () => {
      await expect(service.muteUser(1, 1)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when target user to mute does not exist', async () => {
      mockUserRepository.findOne.mockImplementation(({ where }: any) => {
        if (where.id === 1) return Promise.resolve(createMockUser(1, 'alice'));
        return Promise.resolve(null);
      });

      await expect(service.muteUser(1, 999)).rejects.toThrow(NotFoundException);
    });

    it('successfully mutes a target user and invalidates caches', async () => {
      const user1 = createMockUser(1, 'alice');
      const user2 = createMockUser(2, 'bob');

      mockUserRepository.findOne.mockImplementation(({ where }: any) => {
        if (where.id === 1) return Promise.resolve(user1);
        if (where.id === 2) return Promise.resolve(user2);
        return Promise.resolve(null);
      });

      const result = await service.muteUser(1, 2);

      expect(result.success).toBe(true);
      expect(result.precedence).toBe('mute');
      expect(result.mutedUserIds).toContain(2);
      expect(mockCacheManager.del).toHaveBeenCalled();
    });

    it('successfully unmutes a target user', async () => {
      const user1 = createMockUser(1, 'alice', [], [2]);

      mockUserRepository.findOne.mockImplementation(({ where }: any) => {
        if (where.id === 1) return Promise.resolve(user1);
        return Promise.resolve(null);
      });

      const result = await service.unmuteUser(1, 2);

      expect(result.success).toBe(true);
      expect(result.precedence).toBe('allow');
      expect(result.mutedUserIds).not.toContain(2);
    });
  });

  describe('Public profile navigation targets', () => {
    it('allows viewing unblocked, unmuted profile', async () => {
      const user1 = createMockUser(1, 'alice');
      const user2 = createMockUser(2, 'bob');

      mockUserRepository.findOne.mockImplementation(({ where }: any) => {
        if (where.id === 1) return Promise.resolve(user1);
        if (where.id === 2) return Promise.resolve(user2);
        return Promise.resolve(null);
      });

      const profile = await service.getPublicProfile(2, 1);
      expect(profile.username).toBe('bob');
      expect(profile.isMuted).toBe(false);
    });

    it('returns isMuted: true without error when viewing a muted profile', async () => {
      const user1 = createMockUser(1, 'alice', [], [2]);
      const user2 = createMockUser(2, 'bob');

      mockUserRepository.findOne.mockImplementation(({ where }: any) => {
        if (where.id === 1) return Promise.resolve(user1);
        if (where.id === 2) return Promise.resolve(user2);
        return Promise.resolve(null);
      });

      const profile = await service.getPublicProfile(2, 1);
      expect(profile.username).toBe('bob');
      expect(profile.isMuted).toBe(true);
    });

    it('throws ForbiddenException when target profile is blocked by viewer', async () => {
      const user1 = createMockUser(1, 'alice', [2], []);
      const user2 = createMockUser(2, 'bob');

      mockUserRepository.findOne.mockImplementation(({ where }: any) => {
        if (where.id === 1) return Promise.resolve(user1);
        if (where.id === 2) return Promise.resolve(user2);
        return Promise.resolve(null);
      });

      await expect(service.getPublicProfile(2, 1)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when viewer is blocked by target profile', async () => {
      const user1 = createMockUser(1, 'alice');
      const user2 = createMockUser(2, 'bob', [1], []);

      mockUserRepository.findOne.mockImplementation(({ where }: any) => {
        if (where.id === 1) return Promise.resolve(user1);
        if (where.id === 2) return Promise.resolve(user2);
        return Promise.resolve(null);
      });

      await expect(service.getPublicProfile(2, 1)).rejects.toThrow(ForbiddenException);
    });
  });
});
