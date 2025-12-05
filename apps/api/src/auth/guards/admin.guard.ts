import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly defaultAdminEmail = (
    process.env.DEFAULT_ADMIN_EMAIL ?? 'admin@example.com'
  ).toLowerCase();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as { isAdmin?: boolean; email?: string } | undefined;
    if (user?.isAdmin) {
      return true;
    }
    if (user?.email && user.email.toLowerCase() === this.defaultAdminEmail) {
      return true;
    }
    throw new ForbiddenException('Admin privileges required');
  }
}
