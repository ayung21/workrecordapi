import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppService {
  constructor(private readonly config: ConfigService) {}

  getRootInfo() {
    const port = this.config.get<string>('PORT', '3000');
    return {
      name: 'WorkRecord API',
      status: 'ok',
      docs: '/docs',
      health: '/health',
      port: Number(port),
    };
  }

  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
