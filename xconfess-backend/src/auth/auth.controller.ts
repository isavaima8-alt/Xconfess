import {
  Body,
  BadRequestException,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { StepUpGuard } from './guards/step-up.guard';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { StepUpDto } from './dto/step-up.dto';
import { StepUpService } from './step-up.service';
import { AuthenticatedRequest } from './interfaces/jwt-payload.interface';
import { ChangeEmailDto } from './dto/change-email.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailChangeDto } from './dto/verify-email-change.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly stepUpService: StepUpService,
  ) {}

  @Post('step-up')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Re-authenticate for a sensitive account change' })
  async stepUp(
    @Body() dto: StepUpDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.stepUpService.createProof(request.user.id, dto);
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Request a password reset email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() request: Request) {
    const forwardedFor = request.headers['x-forwarded-for'];
    const ipAddress =
      request.ip ??
      (Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor?.split(',')[0]?.trim()) ??
      request.socket?.remoteAddress;
    const userAgent = request.headers['user-agent'];
    try {
      return await this.authService.forgotPassword(
        dto,
        ipAddress,
        Array.isArray(userAgent) ? userAgent[0] : userAgent,
      );
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      return {
        message: 'If the user exists, a password reset email has been sent.',
      };
    }
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset a password with a recovery token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @Post('email-change')
  @UseGuards(JwtAuthGuard, StepUpGuard)
  @ApiOperation({ summary: 'Request a verified account email change' })
  async requestEmailChange(
    @Body() dto: ChangeEmailDto,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return await this.authService.requestEmailChange(
        request.user.id,
        dto.newEmail,
      );
    } catch {
      return {
        message:
          'If the account exists, a verification email has been sent to the new address.',
      };
    }
  }

  @Post('email-change/verify')
  @ApiOperation({ summary: 'Verify and activate a pending email change' })
  async verifyEmailChange(@Body() dto: VerifyEmailChangeDto) {
    return this.authService.verifyEmailChange(dto.token);
  }

  @Post('email-change/rollback')
  @UseGuards(JwtAuthGuard, StepUpGuard)
  @ApiOperation({ summary: 'Restore the previous email during its recovery window' })
  async rollbackEmailChange(@Req() request: AuthenticatedRequest) {
    return this.authService.rollbackEmailChange(request.user.id);
  }
}