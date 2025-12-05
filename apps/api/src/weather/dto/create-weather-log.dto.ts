import { IsISO8601, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateWeatherLogDto {
  @IsString()
  city: string;

  @IsISO8601()
  timestamp: string;

  @IsString()
  source: string;

  @IsObject()
  metrics: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  meta: Record<string, string>;
}
