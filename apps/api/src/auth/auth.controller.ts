import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { LoginUserDto } from './dto/login-user.dto';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { SafeUser } from '../users/users.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() payload: LoginUserDto) {
    const user = await this.authService.validateUser(payload.email, payload.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.authService.login(user);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() request: Request) {
    return request.user as SafeUser;
  }
}
