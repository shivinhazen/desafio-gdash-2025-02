import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsISO8601, IsOptional, Min } from 'class-validator';

export class FindWeatherLogsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsISO8601()
  start?: string;

  @IsOptional()
  @IsISO8601()
  end?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  rainOnly?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  windOnly?: boolean;
}
