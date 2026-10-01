import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EmployeeRecordsService } from './employee-records.service';
import { Public } from '../common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload';
import { CreateEmployeeRecordDto } from './dto/create-employee-record.dto';
import { UpdateEmployeeRecordDto } from './dto/update-employee-record.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('employee-records')
@Controller('companies/:companyId/employee-records')
export class EmployeeRecordsController {
  constructor(private readonly records: EmployeeRecordsService) {}

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  list(
    @Param('companyId') companyId: string,
    @CurrentUser() user?: JwtPayload,
    @Query('viewToken') viewToken?: string,
  ) {
    return this.records.list(companyId, user, viewToken);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('approvals/pending')
  pending(@Param('companyId') companyId: string) {
    return this.records.listPendingApprovals(companyId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('approvals/:requestId/approve')
  approve(
    @Param('requestId') requestId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.records.approveChange(requestId, user);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  getOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user?: JwtPayload,
    @Query('viewToken') viewToken?: string,
  ) {
    return this.records.getOne(companyId, id, user, viewToken);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Param('companyId') companyId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateEmployeeRecordDto,
  ) {
    return this.records.create(companyId, user, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateEmployeeRecordDto,
  ) {
    return this.records.update(companyId, id, user, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.records.softDelete(companyId, id, user);
  }

}
