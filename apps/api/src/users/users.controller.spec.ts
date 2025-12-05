import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersController } from './users.controller';

describe('UsersController guardas', () => {
  it('aplica JwtAuthGuard no controller inteiro', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, UsersController as any);
    expect(guards).toBeDefined();
    expect(guards).toContain(JwtAuthGuard);
  });
});
