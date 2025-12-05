import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { SafeUser } from '../users/users.service';

describe('AuthService', () => {
  let authService: AuthService;
  let usersServiceMock: {
    findEntityByEmail: jest.Mock;
    sanitize: jest.Mock;
  };

  const sanitizedUser: SafeUser = {
    id: 'user-id',
    name: 'GDASH Admin',
    email: 'admin@example.com',
  };

  beforeEach(async () => {
    const hashedPassword = await bcrypt.hash('123456', 10);
    usersServiceMock = {
      findEntityByEmail: jest.fn(async (email: string) => {
        if (email === sanitizedUser.email) {
          return { ...sanitizedUser, password: hashedPassword } as never;
        }
        return null;
      }),
      sanitize: jest.fn().mockReturnValue(sanitizedUser),
    };

    const jwtService = new JwtService({
      secret: 'test-secret',
      signOptions: { expiresIn: '1h' },
    });

    authService = new AuthService(usersServiceMock as never, jwtService);
  });

  it('validates credentials and returns safe user', async () => {
    const result = await authService.validateUser('admin@example.com', '123456');
    expect(result).toEqual(sanitizedUser);
    expect(usersServiceMock.findEntityByEmail).toHaveBeenCalledWith('admin@example.com');
  });

  it('returns null when password is invalid', async () => {
    const result = await authService.validateUser('admin@example.com', 'wrong');
    expect(result).toBeNull();
  });

  it('returns null when user is missing', async () => {
    const result = await authService.validateUser('unknown@example.com', '123456');
    expect(result).toBeNull();
  });

  it('signs a JWT payload containing user info', () => {
    const response = authService.login(sanitizedUser);
    expect(response).toHaveProperty('access_token');
    expect(typeof response.access_token).toBe('string');
  });
});
