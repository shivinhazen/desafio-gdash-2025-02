import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { Buffer as NodeBuffer } from 'node:buffer';
import { Workbook } from 'exceljs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateWeatherLogDto } from './dto/create-weather-log.dto';
import { FindWeatherLogsDto } from './dto/find-weather-logs.dto';
import { WeatherLog, WeatherLogDocument } from './schemas/weather-log.schema';

const RAIN_ALERT_THRESHOLD = 45;
const WIND_ALERT_THRESHOLD = 25;

export type WeatherInsights = {
  totalLogs: number;
  latestCity?: string;
  latestSource?: string;
  latestTimestamp?: string;
  averageTemperature?: number;
  averageHumidity?: number;
  minTemperature?: number;
  maxTemperature?: number;
  maxWindSpeed?: number;
  rainAlert: boolean;
};

@Injectable()
export class WeatherService {
  constructor(
    @InjectModel(WeatherLog.name)
    private readonly weatherModel: Model<WeatherLogDocument>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(createDto: CreateWeatherLogDto): Promise<WeatherLog> {
    const timestamp = new Date(createDto.timestamp);
    const normalizedTimestamp = Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;
    const normalizedMetrics = this.normalizeMetrics(createDto.metrics ?? {});
    const meta = createDto.meta ?? {};

    const filter = {
      city: createDto.city,
      timestamp: normalizedTimestamp,
    };

    const update = {
      $set: {
        city: createDto.city,
        timestamp: normalizedTimestamp,
        source: createDto.source,
        metrics: normalizedMetrics,
        meta,
      },
    };

    const updated =
      (await this.weatherModel
        .findOneAndUpdate(filter, update, {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        })
        .exec()) ?? (await this.weatherModel.findOne(filter).exec());

    if (updated) {
      this.eventEmitter.emit('weather.log.created', updated);
      return updated;
    }

    // fallback: should not happen, but ensures method always returns a document
    const created = new this.weatherModel({
      city: createDto.city,
      timestamp: normalizedTimestamp,
      source: createDto.source,
      metrics: normalizedMetrics,
      meta,
    });
    const saved = await created.save();
    this.eventEmitter.emit('weather.log.created', saved);
    return saved;
  }

  async findAll(filters: FindWeatherLogsDto = new FindWeatherLogsDto()): Promise<{
    total: number
    items: WeatherLog[]
  }> {
    const { page = 1, limit = 20, start, end, rainOnly, windOnly } = filters;
    const query: Record<string, unknown> = {};
    if (start || end) {
      const timestampFilter: Record<string, Date> = {};
      if (start) {
        timestampFilter.$gte = new Date(start);
      }
      if (end) {
        timestampFilter.$lte = new Date(end);
      }
      query.timestamp = timestampFilter;
    }
    if (rainOnly) {
      query['metrics.rain_chance'] = { $gte: RAIN_ALERT_THRESHOLD };
    }
    if (windOnly) {
      query['metrics.wind_speed'] = { $gte: WIND_ALERT_THRESHOLD };
    }
    const skip = (page - 1) * limit;
    const filterQuery = query as FilterQuery<WeatherLogDocument>;
    const [items, total] = await Promise.all([
      this.weatherModel
        .find(filterQuery)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.weatherModel.countDocuments(filterQuery).exec(),
    ]);
    return { total, items };
  }

  private async fetchAllLogs(): Promise<WeatherLog[]> {
    return this.weatherModel.find().sort({ timestamp: -1 }).lean().exec();
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

  private csvEscape(value: string): string {
    const escaped = value.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  async exportCsv(): Promise<string> {
    const logs = await this.fetchAllLogs();
    const header = ['City', 'Timestamp', 'Source', 'Metrics', 'Meta'].join(',');
    const rows = logs.map((log) => {
      const row = [
        this.csvEscape(log.city ?? ''),
        this.csvEscape(new Date(log.timestamp).toISOString()),
        this.csvEscape(log.source ?? ''),
        this.csvEscape(JSON.stringify(log.metrics ?? {})),
        this.csvEscape(JSON.stringify(log.meta ?? {})),
      ];
      return row.join(',');
    });
    return [header, ...rows].join('\n');
  }

  async exportXlsx(): Promise<NodeBuffer> {
    const logs = await this.fetchAllLogs();
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('weather_logs');
    sheet.columns = [
      { header: 'City', key: 'city', width: 25 },
      { header: 'Timestamp', key: 'timestamp', width: 25 },
      { header: 'Source', key: 'source', width: 20 },
      { header: 'Metrics', key: 'metrics', width: 40 },
      { header: 'Meta', key: 'meta', width: 30 },
    ];
    logs.forEach((log) => {
      sheet.addRow({
        city: log.city,
        timestamp: new Date(log.timestamp).toISOString(),
        source: log.source,
        metrics: JSON.stringify(log.metrics ?? {}),
        meta: JSON.stringify(log.meta ?? {}),
      });
    });
    const raw = await workbook.xlsx.writeBuffer();
    return NodeBuffer.from(raw as ArrayBuffer);
  }

  async insights(): Promise<WeatherInsights> {
    const logs = await this.fetchAllLogs();
    const totalLogs = logs.length;
    const temps = logs
      .map((log) => this.toNumber(log.metrics?.temperature))
      .filter((value): value is number => value !== null);
    const humidities = logs
      .map((log) => this.toNumber(log.metrics?.humidity))
      .filter((value): value is number => value !== null);
    const windSpeeds = logs
      .map((log) => this.toNumber(log.metrics?.wind_speed))
      .filter((value): value is number => value !== null);

    const latest = logs[0];
    const rainAlert = logs.some((log) => {
      const rainChance = this.toNumber(log.metrics?.rain_chance);
      if (rainChance !== null && rainChance >= 45) {
        return true;
      }
      const panel = log.metrics?.condition;
      return typeof panel === 'string' && panel.toLowerCase().includes('rain');
    });

    return {
      totalLogs,
      latestCity: latest?.city,
      latestSource: latest?.source,
      latestTimestamp: latest?.timestamp ? new Date(latest.timestamp).toISOString() : undefined,
      averageTemperature:
        temps.length > 0 ? temps.reduce((acc, value) => acc + value, 0) / temps.length : undefined,
      averageHumidity:
        humidities.length > 0
          ? humidities.reduce((acc, value) => acc + value, 0) / humidities.length
          : undefined,
      minTemperature: temps.length > 0 ? Math.min(...temps) : undefined,
      maxTemperature: temps.length > 0 ? Math.max(...temps) : undefined,
      maxWindSpeed: windSpeeds.length > 0 ? Math.max(...windSpeeds) : undefined,
      rainAlert,
    };
  }

  private normalizeMetrics(metrics: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};
    Object.entries(metrics).forEach(([key, value]) => {
      if (typeof value === 'string') {
        const sanitized = value.replace(',', '.').trim();
        const parsed = Number(sanitized);
        normalized[key] = Number.isNaN(parsed) ? value : parsed;
        return;
      }
      normalized[key] = value;
    });
    return normalized;
  }

  async findLatestLog(): Promise<WeatherLog | null> {
    return this.weatherModel.findOne().sort({ timestamp: -1 }).exec();
  }
}
