import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  Query,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OwnershipGuard } from '../common/guards/ownership.guard';
import { Ownership } from '../common/decorators/ownership.decorator';
import { UserService } from './user.service';
import { UpdatePersonalizationDto } from './dto/update-personalization.dto';
import {
  UpdatePrivacySettingsDto,
  PrivacySettingsResponseDto,
} from './dto/update-privacy-settings.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { StepUpGuard } from '../auth/guards/step-up.guard';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('privacy-settings')
  async getPrivacySettings(@Req() request: any): Promise<PrivacySettingsResponseDto> {
    return this.userService.getPrivacySettings(
      Number(request.user?.id ?? request.user?.sub),
    );
  }

  @Patch('privacy-settings')
  @UseGuards(StepUpGuard)
  async updatePrivacySettings(
    @Body() dto: UpdatePrivacySettingsDto,
    @Req() request: any,
  ): Promise<PrivacySettingsResponseDto> {
    return this.userService.updatePrivacySettings(
      Number(request.user?.id ?? request.user?.sub),
      dto,
    );
  }

  @Patch('me/password')
  @UseGuards(StepUpGuard)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() request: any,
  ): Promise<{ message: string }> {
    await this.userService.updatePassword(
      Number(request.user?.id ?? request.user?.sub),
      dto.newPassword,
    );
    return { message: 'Password has been updated.' };
  }

  @Post('me/recovery-codes')
  @UseGuards(StepUpGuard)
  async regenerateRecoveryCodes(@Req() request: any): Promise<{ recoveryCodes: string[] }> {
    const recoveryCodes = await this.userService.regenerateRecoveryCodes(
      Number(request.user?.id ?? request.user?.sub),
    );
    return { recoveryCodes };
  }

  @Delete('me/recovery-codes')
  @UseGuards(StepUpGuard)
  async revokeRecoveryCodes(@Req() request: any): Promise<{ message: string }> {
    await this.userService.revokeRecoveryCodes(
      Number(request.user?.id ?? request.user?.sub),
    );
    return { message: 'Recovery codes have been revoked.' };
  }

  @Delete('me/totp')
  @UseGuards(StepUpGuard)
  async disableTotp(@Req() request: any): Promise<{ message: string }> {
    await this.userService.disableTotp(
      Number(request.user?.id ?? request.user?.sub),
    );
    return { message: 'Two-factor authentication has been disabled.' };
  }

  /** Get authenticated user's block/mute preferences */
  @Get('me/blocks-mutes')
  async getBlockMutePreferences(@Req() req: any) {
    const userId = Number(req.user?.id ?? req.user?.sub);
    return this.userService.getBlockMutePreferences(userId);
  }

  /** Block a user */
  @Post(':targetUserId/block')
  async blockUser(@Param('targetUserId') targetUserId: string, @Req() req: any) {
    const userId = Number(req.user?.id ?? req.user?.sub);
    return this.userService.blockUser(userId, parseInt(targetUserId, 10));
  }

  /** Unblock a user */
  @Delete(':targetUserId/block')
  async unblockUser(@Param('targetUserId') targetUserId: string, @Req() req: any) {
    const userId = Number(req.user?.id ?? req.user?.sub);
    return this.userService.unblockUser(userId, parseInt(targetUserId, 10));
  }

  /** Mute a user */
  @Post(':targetUserId/mute')
  async muteUser(@Param('targetUserId') targetUserId: string, @Req() req: any) {
    const userId = Number(req.user?.id ?? req.user?.sub);
    return this.userService.muteUser(userId, parseInt(targetUserId, 10));
  }

  /** Unmute a user */
  @Delete(':targetUserId/mute')
  async unmuteUser(@Param('targetUserId') targetUserId: string, @Req() req: any) {
    const userId = Number(req.user?.id ?? req.user?.sub);
    return this.userService.unmuteUser(userId, parseInt(targetUserId, 10));
  }

  /** Public profile — no ownership required */
  @Get([':userId/profile', ':userId/public-profile'])
  async getPublicProfile(@Param('userId') userId: string, @Req() req?: any) {
    const requestingUserId = req?.user?.id ?? req?.user?.sub;
    if (requestingUserId !== undefined && requestingUserId !== null) {
      return this.userService.getPublicProfile(userId, Number(requestingUserId));
    }
    return this.userService.getPublicProfile(userId);
  }

  /** Get authenticated user's own profile summary */
  @Get('profile/summary')
  async getMyProfileSummary(@Req() req: any) {
    const userId = req.user.id ?? req.user.sub;
    return this.userService.getProfileSummary(userId);
  }

  /** Get authenticated user's dashboard stats */
  @Get('stats')
  async getMyStats(@Req() req: any) {
    const userId = req.user.id ?? req.user.sub;
    return this.userService.getDashboardStats(Number(userId));
  }

  /** Get specific user's profile summary (with ownership check) */
  @Get(':userId/profile/summary')
  @UseGuards(OwnershipGuard)
  @Ownership({ paramKey: 'userId' })
  async getProfileSummary(
    @Param('userId') userId: string,
  ) {
    return this.userService.getProfileSummary(parseInt(userId, 10));
  }

  /** Get user's activities list (with ownership check) */
  @Get(':userId/activities')
  @UseGuards(OwnershipGuard)
  @Ownership({ paramKey: 'userId' })
  async getUserActivities(
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const l = limit ? parseInt(limit, 10) : 10;
    return this.userService.getUserActivitiesList(parseInt(userId, 10), p, l);
  }

  /** Get user's confessions list (with ownership check) */
  @Get(':userId/confessions')
  @UseGuards(OwnershipGuard)
  @Ownership({ paramKey: 'userId' })
  async getUserConfessions(
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const l = limit ? parseInt(limit, 10) : 10;
    return this.userService.getUserConfessionsList(parseInt(userId, 10), p, l);
  }

  /**
   * PATCH /users/me/personalization
   * Explicitly toggles the non-personalized discovery mode for the
   * authenticated user. Persists the preference and invalidates any cached
   * personalized results so hidden signals stop affecting discovery.
   *
   * Failure semantics:
   *  - 401 when the request is unauthenticated (JwtAuthGuard).
   *  - 403 when the caller is not the account owner.
   */
  @Patch('me/personalization')
  @UseGuards(JwtAuthGuard)
  async updatePersonalization(
    @Body() dto: UpdatePersonalizationDto,
    @Req() req: any,
  ) {
    const authedUserId = req.user?.id ?? req.user?.sub;
    if (authedUserId === undefined || authedUserId === null) {
      throw new UnauthorizedException('Authentication required');
    }

    if (dto.userId !== undefined && String(dto.userId) !== String(authedUserId)) {
      throw new ForbiddenException(
        'You may only change your own personalization preference',
      );
    }

    return this.userService.updatePersonalizationPreference(
      Number(authedUserId),
      dto.nonPersonalized,
    );
  }

  /**
   * PATCH /users/:userId/settings
   * Ownership enforced independently at backend.
   */
  @Patch(':userId/settings')
  @UseGuards(OwnershipGuard, StepUpGuard)
  @Ownership({ paramKey: 'userId' })
  async updateSettings(
    @Param('userId') userId: string,
    @Body() dto: Record<string, unknown>,
    @Req() req: any,
  ) {
    const authedUserId = req.user.id ?? req.user.sub;
    return this.userService.updateSettings(authedUserId, dto);
  }

  /**
   * DELETE /users/:userId
   * Only the account owner can delete it (admin handled separately).
   */
  @Delete(':userId')
  @UseGuards(OwnershipGuard)
  @Ownership({ paramKey: 'userId', adminBypass: true })
  async deleteAccount(@Param('userId') userId: string, @Req() req: any) {
    const authedUserId = req.user.id ?? req.user.sub;
    return this.userService.deleteAccount(authedUserId);
  }
}
