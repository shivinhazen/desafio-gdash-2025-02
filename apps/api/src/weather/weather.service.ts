import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateWeatherLogDto } from './dto/create-weather-log.dto';
import { WeatherLog, WeatherLogDocument } from './schemas/weather-log.schema';

@Injectable()
export class WeatherService {
  constructor(
    @InjectModel(WeatherLog.name)
    private readonly weatherModel: Model<WeatherLogDocument>,
  ) {}

  async create(createDto: CreateWeatherLogDto): Promise<WeatherLog> {
    const timestamp = new Date(createDto.timestamp);
    const doc = new this.weatherModel({
      ...createDto,
      timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
    });
    return doc.save();
  }

  async findAll(page = 1, limit = 20): Promise<{ total: number; items: WeatherLog[] }> {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.weatherModel
        .find()
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.weatherModel.countDocuments().exec(),
    ]);
    return { total, items };
  }
}
