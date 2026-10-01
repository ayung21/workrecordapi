import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { JwtPayload } from '../types/jwt-payload';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest().user as JwtPayload;
    if (!user) throw new ForbiddenException();
    if (user.roleCode === 'OWNER') return true;

    const has = required.every((p) => user.permissions.includes(p));
    if (!has) throw new ForbiddenException('Insufficient permissions');
    return true;
  }
}
