import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AdminCriticalAction } from '../entities/admin-action-approval.entity';

export class RequestActionApprovalDto {
  @IsEnum(AdminCriticalAction)
  action: AdminCriticalAction;

  @IsUUID()
  targetId: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}

export class CancelActionApprovalDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
