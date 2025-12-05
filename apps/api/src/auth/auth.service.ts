import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { SafeUser, UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<SafeUser | null> {
    const user = await this.usersService.findEntityByEmail(email);
    if (!user) {
      return null;
    }

    const matches = await bcrypt.compare(password, user.password);
    if (!matches) {
      return null;
    }

    return this.usersService.sanitize(user);
  }

  login(user: SafeUser) {
    const payload = { sub: user.id, email: user.email, isAdmin: user.isAdmin };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
