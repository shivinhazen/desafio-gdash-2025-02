import { Injectable, Logger } from '@nestjs/common';
import { WeatherLog } from '../weather/schemas/weather-log.schema';
import { WeatherService } from '../weather/weather.service';

export interface ClimoInput {
  temperature: number;
  humidity: number;
  windSpeed: number;
  uvIndex: number;
  rainProbability: number;
  sunsetTime: string;
  location: string;
}

export interface ClimoResponse {
  title: string;
  message: string;
  generatedAt: string;
}

const SLEEPY_MESSAGE = 'Climo está tirando um cochilo. Tente de novo em instantes 😴';

@Injectable()
export class ClimoService {
  private readonly logger = new Logger(ClimoService.name);

  constructor(private readonly weatherService: WeatherService) {}

  async generateInsight(input?: ClimoInput): Promise<ClimoResponse> {
    try {
      const resolved = await this.resolveInput(input);
      if (!resolved) {
        return this.sleepyResponse();
      }

      const insight = this.buildLocalInsight(resolved);
      return {
        ...insight,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn('Climo insight generation failed', error);
      return this.sleepyResponse();
    }
  }

  private async resolveInput(input?: ClimoInput): Promise<ClimoInput | null> {
    if (input) {
      return input;
    }
    const latestLog = await this.weatherService.findLatestLog();
    if (!latestLog) {
      return null;
    }
    return this.mapLogToInput(latestLog);
  }

  private mapLogToInput(log: WeatherLog): ClimoInput {
    const metrics = log.metrics ?? {};

    const temperature = this.toNumber(metrics.temperature) ?? 25;
    const humidity = this.toNumber(metrics.humidity) ?? 60;
    const windSpeed = this.toNumber(metrics.wind_speed) ?? this.toNumber(metrics.windSpeed) ?? 12;
    const uvIndex = this.toNumber(metrics.uv_index) ?? 6;

    const rainValue = this.toNumber(metrics.rain) ?? 0;
    const rainProbability = Math.min(100, Math.round(rainValue > 0 ? 70 : 10));

    const sunsetMeta = typeof log.meta?.sunset === 'string' ? log.meta.sunset : undefined;
    const sunsetTime = sunsetMeta ?? '17:42';

    const location = log.city ?? 'Búzios, RJ';

    return {
      temperature,
      humidity,
      windSpeed,
      uvIndex,
      rainProbability,
      sunsetTime,
      location,
    };
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.replace(',', '.').trim();
      const parsed = Number(normalized);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  private buildLocalInsight(input: ClimoInput): Omit<ClimoResponse, 'generatedAt'> {
    const lines: string[] = [];
    const location = input.location ?? 'essa região';

    lines.push(
      `Sensação térmica ${input.temperature.toFixed(1)}°C e ${input.humidity.toFixed(0)}% de umidade em ${location}.`,
    );

    const windDescriptor =
      input.windSpeed >= 25
        ? 'Ventos fortes'
        : input.windSpeed >= 15
        ? 'Brisa constante'
        : 'Mar relativamente calmo';
    const uvDescriptor =
      input.uvIndex >= 8
        ? 'UV alta, protetor indispensável 🧴'
        : input.uvIndex >= 6
        ? 'UV marcando, leve o protetor'
        : 'UV amena, sol convidativo';
    lines.push(
      `Vento ${input.windSpeed.toFixed(0)} km/h (${windDescriptor}) · UV ${input.uvIndex.toFixed(1)} (${uvDescriptor}).`,
    );

    const rainDescriptor =
      input.rainProbability >= 60
        ? 'Carregando chances de pancadas, leve impermeável'
        : input.rainProbability >= 30
        ? 'Possibilidade de chuvisco, tenha capa'
        : 'Chuva pouca, mar claro para 🌊';
    lines.push(`Chance de chuva ${input.rainProbability.toFixed(0)}% — ${rainDescriptor}.`);

    const beach =
      input.windSpeed < 20 && input.rainProbability < 40 ? 'Ferradurinha' : 'Praia do Forno';
    const beachEmoji = beach === 'Ferradurinha' ? '🐚' : '⛱️';
    lines.push(
      `Melhor hora para curtir ${beach} ${beachEmoji} até o pôr do sol às ${input.sunsetTime}.`,
    );

    return {
      title: 'Climo diz:',
      message: lines.join('\n'),
    };
  }

  private sleepyResponse(): ClimoResponse {
    return {
      title: 'Climo descansando',
      message: SLEEPY_MESSAGE,
      generatedAt: new Date().toISOString(),
    };
  }
}
