import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { AppModule } from './app.module';
import { JwtPayload } from './auth/types/jwt-payload';
import { PaymentLiveHub } from './payments/payment-live.hub';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const corsOrigins =
    process.env.CORS_ORIGINS?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [
      'http://localhost:3008',
      'http://127.0.0.1:3008',
    ];
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('WorkRecord API')
    .setDescription(
      'API netral untuk verifikasi riwayat kerja karyawan — langganan, pembayaran, dan akses token.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  const jwt = app.get(JwtService);
  const live = app.get(PaymentLiveHub);
  const wss = new WebSocketServer({ noServer: true });
  const server = app.getHttpServer();
  server.on(
    'upgrade',
    (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/payments/live') {
      socket.destroy();
      return;
    }
    let user: JwtPayload;
    try {
      user = jwt.verify<JwtPayload>(url.searchParams.get('token') ?? '');
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    if (user.roleCode !== 'OWNER') {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      live.add(ws);
      ws.send(JSON.stringify({ type: 'ready' }));
      });
    },
  );
}
bootstrap();
