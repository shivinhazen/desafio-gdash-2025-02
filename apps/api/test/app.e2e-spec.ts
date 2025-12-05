import { BadRequestException, INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { UsersController } from '../src/users/users.controller';
import { UsersService, SafeUser } from '../src/users/users.service';
import { CreateUserDto } from '../src/users/dto/create-user.dto';
import { UpdateUserDto } from '../src/users/dto/update-user.dto';
import { WeatherController } from '../src/weather/weather.controller';
import { WeatherService } from '../src/weather/weather.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const passport = require('passport');
type UserRecord = SafeUser & { password: string };

class InMemoryUsersService {
  private users = new Map<string, UserRecord>();
  private nextId = 2;

  constructor() {
    const hashed = bcrypt.hashSync('123456', 10);
    this.users.set('1', {
      id: '1',
      name: 'GDASH Admin',
      email: 'admin@example.com',
      password: hashed,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  private sanitize(record: UserRecord): SafeUser {
    const { password, ...rest } = record;
    return rest;
  }

  private findRecordByEmail(email: string): UserRecord | undefined {
    const normalized = email.toLowerCase();
    return Array.from(this.users.values()).find((user) => user.email === normalized);
  }

  async create(createDto: CreateUserDto): Promise<SafeUser> {
    const normalizedEmail = createDto.email.toLowerCase();
    if (this.findRecordByEmail(normalizedEmail)) {
      throw new BadRequestException('User already exists');
    }
    const hashed = await bcrypt.hash(createDto.password, 10);
    const record: UserRecord = {
      id: String(this.nextId++),
      name: createDto.name,
      email: normalizedEmail,
      password: hashed,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(record.id, record);
    return this.sanitize(record);
  }

  async findAll(page = 1, limit = 20) {
    const items = Array.from(this.users.values())
      .slice((page - 1) * limit, page * limit)
      .map((user) => this.sanitize(user));
    return { total: this.users.size, items };
  }

  async findById(id: string): Promise<SafeUser | null> {
    const record = this.users.get(id);
    return record ? this.sanitize(record) : null;
  }

  async findEntityById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async findEntityByEmail(email: string): Promise<UserRecord | null> {
    return this.findRecordByEmail(email) ?? null;
  }

  async update(id: string, updateDto: UpdateUserDto): Promise<SafeUser> {
    const target = this.users.get(id);
    if (!target) {
      throw new NotFoundException('User not found');
    }
    if (updateDto.email) {
      const normalized = updateDto.email.toLowerCase();
      const conflict = Array.from(this.users.values()).find(
        (user) => user.email === normalized && user.id !== id,
      );
      if (conflict) {
        throw new BadRequestException('User already exists');
      }
      target.email = normalized;
    }
    if (updateDto.name) {
      target.name = updateDto.name;
    }
    if (updateDto.password) {
      target.password = await bcrypt.hash(updateDto.password, 10);
    }
    target.updatedAt = new Date();
    this.users.set(id, target);
    return this.sanitize(target);
  }

  async remove(id: string): Promise<SafeUser> {
    const target = this.users.get(id);
    if (!target) {
      throw new NotFoundException('User not found');
    }
    this.users.delete(id);
    return this.sanitize(target);
  }
}

class StubWeatherService implements Partial<WeatherService> {
  async create() {
    return null;
  }

  async findAll() {
    return { total: 0, items: [] };
  }

  async insights() {
    return {
      totalLogs: 1,
      latestCity: 'Búzios',
      latestSource: 'test',
      latestTimestamp: new Date().toISOString(),
      averageTemperature: 27,
      averageHumidity: 65,
      minTemperature: 24,
      maxTemperature: 31,
      maxWindSpeed: 12,
      rainAlert: true,
    };
  }

  async exportCsv() {
    return 'City,Timestamp,Source,Metrics,Meta\nBúzios,2025-01-01T10:00:00Z,test,"{}", "{}"\n';
  }

  async exportXlsx() {
    return Buffer.from('dummy');
  }
}

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let sharedAccessToken: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({
          secret: 'test-secret',
          signOptions: { expiresIn: '1h' },
        }),
      ],
      controllers: [AppController, AuthController, UsersController, WeatherController],
      providers: [
        AppService,
        AuthService,
        JwtStrategy,
        JwtAuthGuard,
        {
          provide: UsersService,
          useClass: InMemoryUsersService,
        },
        {
          provide: WeatherService,
          useClass: StubWeatherService,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api');
    app.use(passport.initialize());
    await app.init();
  });

  beforeAll(async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: '123456' })
      .expect(201);
    sharedAccessToken = response.body.access_token;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('/api (GET)', async () => {
    await request(app.getHttpServer())
      .get('/api')
      .expect(200)
      .expect('Hello World!');
  });

  describe('auth + users flow', () => {
    it('POST /api/auth/login retorna token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@example.com', password: '123456' })
        .expect(201);
      expect(response.body.access_token).toBeDefined();
    });

    it('GET /api/users sem token retorna 401', async () => {
      await request(app.getHttpServer()).get('/api/users').expect(401);
    });

    it('GET /api/users com token retorna usuários', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/users')
        .set('Authorization', `Bearer ${sharedAccessToken}`)
        .expect(200);
      expect(response.body.items).toBeInstanceOf(Array);
      expect(
        response.body.items.some((item: { email?: string }) => item.email === 'admin@example.com'),
      ).toBe(true);
    });
  });

  describe('weather exports', () => {
    it('GET /api/weather/insights retorna métricas', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/weather/insights')
        .set('Authorization', `Bearer ${sharedAccessToken}`)
        .expect(200);
      expect(response.body).toMatchObject({
        totalLogs: expect.any(Number),
        rainAlert: expect.any(Boolean),
      });
    });

    it('GET /api/weather/export.csv retorna CSV', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/weather/export.csv')
        .set('Authorization', `Bearer ${sharedAccessToken}`)
        .expect(200);
      expect(response.header['content-type']).toContain('text/csv');
      expect(response.text).toContain('City,Timestamp,Source,Metrics,Meta');
    });

    it('GET /api/weather/export.xlsx retorna binário', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/weather/export.xlsx')
        .set('Authorization', `Bearer ${sharedAccessToken}`)
        .responseType('arraybuffer')
        .expect(200);
      expect(response.header['content-type']).toContain(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(Buffer.isBuffer(response.body)).toBe(true);
      expect((response.body as Buffer).length).toBeGreaterThan(0);
    });
  });
});
