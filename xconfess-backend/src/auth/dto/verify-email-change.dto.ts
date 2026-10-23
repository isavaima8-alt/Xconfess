import { IsString, MaxLength, MinLength } from 'class-validator';

export class VerifyEmailChangeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  token!: string;
}
