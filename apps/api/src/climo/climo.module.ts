import { Module } from '@nestjs/common';
import { ClimoController } from './climo.controller';
import { ClimoService } from './climo.service';
import { WeatherModule } from '../weather/weather.module';

@Module({
  imports: [WeatherModule],
  controllers: [ClimoController],
  providers: [ClimoService],
})
export class ClimoModule {}
