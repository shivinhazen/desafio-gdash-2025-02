import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { WeatherLog } from './schemas/weather-log.schema';

@WebSocketGateway({ namespace: 'weather', cors: { origin: true } })
export class WeatherGateway implements OnGatewayInit {
  private readonly logger = new Logger(WeatherGateway.name);

  @WebSocketServer()
  server: Server;

  afterInit(): void {
    this.logger.log('WebSocket gateway initialized');
  }

  @OnEvent('weather.log.created')
  handleLogCreated(log: WeatherLog) {
    this.logger.log('Emitting weather log update via websocket');
    this.server.emit('weather.log.created', log);
  }
}
