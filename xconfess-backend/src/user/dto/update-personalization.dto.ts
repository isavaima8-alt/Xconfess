import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional } from 'class-validator';

export class UpdatePersonalizationDto {
  @IsBoolean()
  nonPersonalized!: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  userId?: number;
}
