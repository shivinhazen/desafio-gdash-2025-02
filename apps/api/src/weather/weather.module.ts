import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WeatherController } from './weather.controller';
import { WeatherGateway } from './weather.gateway';
import { WeatherLog, WeatherLogSchema } from './schemas/weather-log.schema';
import { WeatherService } from './weather.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: WeatherLog.name, schema: WeatherLogSchema }]),
  ],
  controllers: [WeatherController],
  providers: [WeatherService, WeatherGateway],
  exports: [WeatherService],
})
export class WeatherModule {}
