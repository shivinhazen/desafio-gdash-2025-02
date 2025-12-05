import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import type { ClimoInput, ClimoResponse } from './climo.service';
import { ClimoService } from './climo.service';

@Controller('climo')
export class ClimoController {
  constructor(private readonly climoService: ClimoService) {}

  @Post('insight')
  async insight(@Body() payload: ClimoInput): Promise<ClimoResponse> {
    return this.climoService.generateInsight(payload);
  }

  @Get('insight')
  async insightFromQuery(
    @Query('temperature') temperature?: string,
    @Query('humidity') humidity?: string,
    @Query('windSpeed') windSpeed?: string,
    @Query('uvIndex') uvIndex?: string,
    @Query('rainProbability') rainProbability?: string,
    @Query('sunsetTime') sunsetTime?: string,
    @Query('location') location?: string,
  ): Promise<ClimoResponse> {
    const input = this.buildFromQuery({
      temperature,
      humidity,
      windSpeed,
      uvIndex,
      rainProbability,
      sunsetTime,
      location,
    });
    return this.climoService.generateInsight(input);
  }

  private buildFromQuery(params: Record<string, string | undefined>): ClimoInput | undefined {
    const maybeTemperature = this.parseNumber(params.temperature);
    const maybeHumidity = this.parseNumber(params.humidity);
    const maybeWind = this.parseNumber(params.windSpeed);
    const maybeUv = this.parseNumber(params.uvIndex);
    const maybeRain = this.parseNumber(params.rainProbability);

    if (
      maybeTemperature === null ||
      maybeHumidity === null ||
      maybeWind === null ||
      maybeUv === null ||
      maybeRain === null ||
      !params.sunsetTime ||
      !params.location
    ) {
      return undefined;
    }

    return {
      temperature: maybeTemperature,
      humidity: maybeHumidity,
      windSpeed: maybeWind,
      uvIndex: maybeUv,
      rainProbability: maybeRain,
      sunsetTime: params.sunsetTime,
      location: params.location,
    };
  }

  private parseNumber(value: string | undefined): number | null {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.replace(',', '.').trim();
    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? null : parsed;
  }
}
