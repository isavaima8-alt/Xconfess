import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { StepUpGuard } from '../auth/guards/step-up.guard';
import { StepUpService } from '../auth/step-up.service';

describe('UserController', () => {
  let controller: UserController;

  const mockUserService = {
    getPublicProfile: jest.fn(),
    getProfileSummary: jest.fn(),
    getDashboardStats: jest.fn(),
    getUserActivitiesList: jest.fn(),
    getUserConfessionsList: jest.fn(),
    updateSettings: jest.fn(),
    deleteAccount: jest.fn(),
    getPrivacySettings: jest.fn(),
    updatePrivacySettings: jest.fn(),
    updatePassword: jest.fn(),
    regenerateRecoveryCodes: jest.fn(),
    revokeRecoveryCodes: jest.fn(),
    disableTotp: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: mockUserService },
        {
          provide: StepUpService,
          useValue: { assertValidProof: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('loads privacy settings for the authenticated account', async () => {
    const result = { isDiscoverable: true };
    mockUserService.getPrivacySettings.mockResolvedValue(result);

    await expect(
      controller.getPrivacySettings({ user: { id: 42 } }),
    ).resolves.toBe(result);
    expect(mockUserService.getPrivacySettings).toHaveBeenCalledWith(42);
  });

  it('updates privacy only for the authenticated account', async () => {
    const dto = { isDiscoverable: false };
    const result = { ...dto };
    mockUserService.updatePrivacySettings.mockResolvedValue(result);

    await expect(
      controller.updatePrivacySettings(dto, { user: { id: 42 } }),
    ).resolves.toBe(result);
    expect(mockUserService.updatePrivacySettings).toHaveBeenCalledWith(42, dto);
    expect(
      Reflect.getMetadata(
        '__guards__',
        UserController.prototype.updatePrivacySettings,
      ),
    ).toContain(StepUpGuard);
  });

  it('changes a password only after step-up authorization', async () => {
    const dto = { newPassword: 'GoodPass123!' };

    await expect(
      controller.changePassword(dto, { user: { id: 42 } }),
    ).resolves.toEqual({ message: 'Password has been updated.' });
    expect(mockUserService.updatePassword).toHaveBeenCalledWith(
      42,
      dto.newPassword,
    );
    expect(
      Reflect.getMetadata('__guards__', UserController.prototype.changePassword),
    ).toContain(StepUpGuard);
  });

  it('protects recovery-code and authenticator changes with step-up', () => {
    for (const method of [
      'regenerateRecoveryCodes',
      'revokeRecoveryCodes',
      'disableTotp',
      'updateSettings',
    ] as const) {
      expect(
        Reflect.getMetadata('__guards__', UserController.prototype[method]),
      ).toContain(StepUpGuard);
    }
  });

  it('returns regenerated recovery codes only to the authenticated account', async () => {
    const codes = ['once-only'];
    mockUserService.regenerateRecoveryCodes.mockResolvedValue(codes);

    await expect(
      controller.regenerateRecoveryCodes({ user: { id: 42 } }),
    ).resolves.toEqual({ recoveryCodes: codes });
    expect(mockUserService.regenerateRecoveryCodes).toHaveBeenCalledWith(42);
  });

  it('returns public profile data', async () => {
    const profile = { username: 'testuser', stats: { confessions: 2 } };
    mockUserService.getPublicProfile.mockResolvedValue(profile);

    await expect(controller.getPublicProfile('42')).resolves.toBe(profile);
    expect(mockUserService.getPublicProfile).toHaveBeenCalledWith('42');
  });

  it('returns the authenticated profile summary', async () => {
    const summary = { id: 42, username: 'testuser' };
    mockUserService.getProfileSummary.mockResolvedValue(summary);

    await expect(
      controller.getMyProfileSummary({ user: { sub: 42 } }),
    ).resolves.toBe(summary);
    expect(mockUserService.getProfileSummary).toHaveBeenCalledWith(42);
  });

  it('returns a specific profile summary with numeric user id', async () => {
    mockUserService.getProfileSummary.mockResolvedValue({ id: 42 });

    await controller.getProfileSummary('42');
    expect(mockUserService.getProfileSummary).toHaveBeenCalledWith(42);
  });

  it('returns authenticated dashboard stats', async () => {
    const stats = { totalConfessions: 2, totalReactions: 5 };
    mockUserService.getDashboardStats.mockResolvedValue(stats);

    await expect(controller.getMyStats({ user: { id: 42 } })).resolves.toBe(stats);
    expect(mockUserService.getDashboardStats).toHaveBeenCalledWith(42);
  });

  it('returns paginated user activities', async () => {
    mockUserService.getUserActivitiesList.mockResolvedValue({ data: [] });

    await controller.getUserActivities('42', '2', '25');
    expect(mockUserService.getUserActivitiesList).toHaveBeenCalledWith(
      42,
      2,
      25,
    );
  });

  it('returns paginated user confessions', async () => {
    mockUserService.getUserConfessionsList.mockResolvedValue({ data: [] });

    await controller.getUserConfessions('42');
    expect(mockUserService.getUserConfessionsList).toHaveBeenCalledWith(
      42,
      1,
      10,
    );
  });

  it('updates settings for the authenticated user', async () => {
    const dto = { displayName: 'New Name' };
    mockUserService.updateSettings.mockResolvedValue({ ok: true });

    await controller.updateSettings('42', dto, { user: { id: 42 } });
    expect(mockUserService.updateSettings).toHaveBeenCalledWith(42, dto);
  });

  it('deletes the authenticated account', async () => {
    mockUserService.deleteAccount.mockResolvedValue({ deleted: true });

    await controller.deleteAccount('42', { user: { sub: 42 } });
    expect(mockUserService.deleteAccount).toHaveBeenCalledWith(42);
  });
});
