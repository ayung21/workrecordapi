import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CompaniesService } from './companies.service';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { UpdateSurveyDto } from './dto/update-survey.dto';
import { InviteLeadershipDto } from './dto/invite-leadership.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload';

@ApiTags('companies')
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterCompanyDto) {
    return this.companies.register(dto);
  }

  @Public()
  @Get(':id/public')
  findPublic(@Param('id') id: string) {
    return this.companies.findOne(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get()
  @RequirePermissions('companies.manage_all')
  listAll() {
    return this.companies.listForOwner();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Post(':id/leadership/invite')
  inviteLeadership(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: InviteLeadershipDto,
  ) {
    return this.companies.inviteLeadership(id, user, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Patch(':id/survey')
  @RequirePermissions('companies.survey')
  updateSurvey(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateSurveyDto,
  ) {
    return this.companies.updateSurvey(id, dto.status, dto.notes, user.sub);
  }
}
