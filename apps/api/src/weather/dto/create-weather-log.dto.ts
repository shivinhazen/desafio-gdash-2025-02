import { IsObject, IsOptional, IsString } from 'class-validator';

export class CreateWeatherLogDto {
  @IsString()
  city: string;

  @IsString()
  timestamp: string;

  @IsString()
  source: string;

  @IsObject()
  metrics: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  meta: Record<string, string>;
}
