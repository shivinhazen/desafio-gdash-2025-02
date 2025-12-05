import { ValidationPipe, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

jest.setTimeout(120000);

describe('Weather e2e real data', () => {
  let app: INestApplication | null = null;
  let mongod: MongoMemoryServer | null = null;
  let token: string;

  beforeAll(async () => {
    process.env.MONGOMS_STARTUP_TIMEOUT = '120000';
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    process.env.JWT_SECRET = 'real-data-secret';
    process.env.DEFAULT_ADMIN_EMAIL = 'admin@example.com';
    process.env.DEFAULT_ADMIN_PASSWORD = '123456';

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = require('../src/app.module');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api');
    await app.init();

    const auth = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: '123456' })
      .expect(201);
    token = auth.body.access_token;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (mongod) {
      await mongod.stop();
    }
  });

  it('stores logs and exposes insights/export with JWT', async () => {
    const logPayload = {
      city: 'Búzios',
      timestamp: new Date().toISOString(),
      source: 'collector',
      metrics: {
        temperature: 26.5,
        humidity: 60,
        wind_speed: 12,
        rain_chance: 50,
      },
      meta: {
        provider: 'e2e-test',
      },
    };

    await request(app!.getHttpServer())
      .post('/api/weather/logs')
      .set('Authorization', `Bearer ${token}`)
      .send(logPayload)
      .expect(201);

    const oldLogPayload = {
      ...logPayload,
      timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      metrics: {
        ...logPayload.metrics,
        wind_speed: 4,
        rain_chance: 12,
      },
    };

    await request(app!.getHttpServer())
      .post('/api/weather/logs')
      .set('Authorization', `Bearer ${token}`)
      .send(oldLogPayload)
      .expect(201);

    const logs = await request(app!.getHttpServer())
      .get('/api/weather/logs?limit=5')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(logs.body.total).toBeGreaterThan(0);
    expect(logs.body.items[0]).toMatchObject({
      city: 'Búzios',
    });

    const insights = await request(app!.getHttpServer())
      .get('/api/weather/insights')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(insights.body).toMatchObject({
      totalLogs: expect.any(Number),
      rainAlert: true,
    });
    const rainFilter = await request(app!.getHttpServer())
      .get('/api/weather/logs?rainOnly=true&limit=5')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(rainFilter.body.items.length).toBeGreaterThanOrEqual(1);
    expect(rainFilter.body.items.every((item) => item.metrics?.rain_chance >= 45)).toBe(true);

    const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const rangeFilter = await request(app!.getHttpServer())
      .get(`/api/weather/logs?start=${encodeURIComponent(since)}&limit=5`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(rangeFilter.body.items.some((item) => item.metrics?.rain_chance === 50)).toBe(true);
    expect(rangeFilter.body.items.some((item) => item.metrics?.rain_chance === 12)).toBe(false);

    const csv = await request(app!.getHttpServer())
      .get('/api/weather/export.csv')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(csv.header['content-type']).toContain('text/csv');
    expect(csv.text).toContain('City,Timestamp,Source,Metrics,Meta');

    const xlsx = await request(app!.getHttpServer())
      .get('/api/weather/export.xlsx')
      .set('Authorization', `Bearer ${token}`)
      .responseType('arraybuffer')
      .expect(200);
    expect(xlsx.header['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(Buffer.isBuffer(xlsx.body)).toBe(true);
    expect((xlsx.body as Buffer).length).toBeGreaterThan(0);
  });
});
