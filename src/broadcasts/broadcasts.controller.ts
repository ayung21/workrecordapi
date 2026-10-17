import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequireRoles } from '../common/decorators/roles.decorator';
import { PLATFORM_OWNER_ROLE } from '../auth/constants/platform-roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload';
import { BroadcastsService } from './broadcasts.service';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';

@ApiTags('broadcasts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRoles(PLATFORM_OWNER_ROLE)
@Controller('broadcasts')
export class BroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Get()
  list() {
    return this.broadcasts.list();
  }

  @Post()
  send(@CurrentUser() user: JwtPayload, @Body() dto: CreateBroadcastDto) {
    return this.broadcasts.send(dto, user.sub);
  }
}
