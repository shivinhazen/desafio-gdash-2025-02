import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WeatherModule } from './weather/weather.module';
import { ClimoModule } from './climo/climo.module';

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGO_URI ?? 'mongodb://mongo:27017/gdash'),
    EventEmitterModule.forRoot(),
    AuthModule,
    UsersModule,
    WeatherModule,
    ClimoModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
