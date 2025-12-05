import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CreateWeatherLogDto } from './dto/create-weather-log.dto';
import { FindWeatherLogsDto } from './dto/find-weather-logs.dto';
import { WeatherInsights, WeatherService } from './weather.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('weather')
@UseGuards(JwtAuthGuard)
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  @Post('logs')
  async create(@Body() payload: CreateWeatherLogDto) {
    return this.weatherService.create(payload);
  }

  @Get('logs')
  async findAll(@Query() query: FindWeatherLogsDto) {
    return this.weatherService.findAll(query);
  }

  @Get('insights')
  async insights(): Promise<WeatherInsights> {
    return this.weatherService.insights();
  }

  @Get('export.csv')
  async exportCsv(@Res({ passthrough: true }) res: Response) {
    const csv = await this.weatherService.exportCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="weather.csv"');
    return csv;
  }

  @Get('export.xlsx')
  async exportXlsx(@Res({ passthrough: true }) res: Response) {
    const buffer = await this.weatherService.exportXlsx();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="weather.xlsx"');
    return buffer;
  }
}
