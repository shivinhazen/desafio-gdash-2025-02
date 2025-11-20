import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CreateWeatherLogDto } from './dto/create-weather-log.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { WeatherService } from './weather.service';

@Controller('weather')
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  @Post('logs')
  async create(@Body() payload: CreateWeatherLogDto) {
    return this.weatherService.create(payload);
  }

  @Get('logs')
  async findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.weatherService.findAll(page, limit);
  }
}
