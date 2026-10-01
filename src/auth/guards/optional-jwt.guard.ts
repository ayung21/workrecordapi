import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('optional-jwt') {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{ headers: { authorization?: string } }>();
    if (!req.headers.authorization) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser>(err: Error | null, user: TUser): TUser | undefined {
    if (err || !user) return undefined;
    return user;
  }
}
