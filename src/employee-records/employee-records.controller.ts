import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { EmployeeRecordsService } from './employee-records.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload';
import { UpdateEmployeeRecordDto } from './dto/update-employee-record.dto';
import { RejectChangeRequestDto } from './dto/reject-change-request.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('employee-records')
@Controller('companies/:companyId/employee-records')
export class EmployeeRecordsController {
  constructor(private readonly records: EmployeeRecordsService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get()
  list(
    @Param('companyId') companyId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.records.list(companyId, user);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('approvals/pending')
  pending(@Param('companyId') companyId: string) {
    return this.records.listPendingApprovals(companyId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('approvals/rejected')
  rejected(
    @Param('companyId') companyId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.records.listRejectedApprovals(companyId, user);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('approvals/:requestId')
  approvalDetail(
    @Param('companyId') companyId: string,
    @Param('requestId') requestId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.records.getApprovalRequest(companyId, requestId, user);
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

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('approvals/:requestId/reject')
  reject(
    @Param('requestId') requestId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RejectChangeRequestDto,
  ) {
    return this.records.rejectChange(requestId, user, dto.rejectionReason);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id/changes')
  changeHistory(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.records.getChangeHistory(companyId, id, user);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id/photo')
  async photo(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const { data, mime } = await this.records.readPhotoFile(
      companyId,
      id,
      user,
    );
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(data);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  getOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.records.getOne(companyId, id, user);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post()
  @UseInterceptors(FileInterceptor('photo'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'photo',
        'nationalIdNumber',
        'employeeName',
        'placeOfBirth',
        'dateOfBirth',
        'joinedAt',
        'position',
      ],
      properties: {
        photo: { type: 'string', format: 'binary' },
        nationalIdNumber: {
          type: 'string',
          description: 'NIK KTP (16 digit)',
        },
        employeeCode: {
          type: 'string',
          description: 'Nomor ID karyawan internal (opsional, bukan NIK KTP)',
        },
        employeeName: { type: 'string' },
        placeOfBirth: { type: 'string' },
        dateOfBirth: { type: 'string', format: 'date' },
        joinedAt: { type: 'string', format: 'date' },
        leftAt: { type: 'string', format: 'date' },
        position: { type: 'string' },
        conductSummary: { type: 'string' },
      },
    },
  })
  create(
    @Param('companyId') companyId: string,
    @CurrentUser() user: JwtPayload,
    @UploadedFile() photo: { buffer: Buffer; mimetype: string },
    @Body('nationalIdNumber') nationalIdNumber: string,
    @Body('employeeName') employeeName: string,
    @Body('placeOfBirth') placeOfBirth: string,
    @Body('dateOfBirth') dateOfBirth: string,
    @Body('joinedAt') joinedAt: string,
    @Body('position') position: string,
    @Body('leftAt') leftAt?: string,
    @Body('conductSummary') conductSummary?: string,
    @Body('employeeCode') employeeCode?: string,
  ) {
    return this.records.create(
      companyId,
      user,
      {
        nationalIdNumber: nationalIdNumber.replace(/\D/g, ''),
        employeeCode,
        employeeName,
        placeOfBirth,
        dateOfBirth,
        joinedAt,
        position,
        leftAt: leftAt || undefined,
        conductSummary,
      },
      photo,
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @UseInterceptors(FileInterceptor('photo'))
  @ApiConsumes('multipart/form-data', 'application/json')
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateEmployeeRecordDto,
    @UploadedFile() photo?: { buffer: Buffer; mimetype: string },
  ) {
    if (photo?.buffer?.length) {
      return this.records.updateWithPhoto(companyId, id, user, dto, photo);
    }
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
