import {
  Body,
  Controller,
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
import {
  CompanyDocumentsService,
  CompanyDocumentType,
} from './company-documents.service';
import { ReviewCompanyDocumentDto } from './dto/review-company-document.dto';
import { RequestSiteVerificationDto } from './dto/request-site-verification.dto';
import { ScheduleSiteVerificationDto } from './dto/schedule-site-verification.dto';
import { basename } from 'path';

@ApiTags('companies')
@Controller('companies')
export class CompaniesController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly documents: CompanyDocumentsService,
  ) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterCompanyDto) {
    return this.companies.register(dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.companies.getMyCompany(user);
  }

  @Public()
  @Get('member-verify/:token')
  publicMemberVerify(@Param('token') token: string) {
    return this.documents.getPublicMemberVerification(token);
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
  @UseGuards(JwtAuthGuard)
  @Get(':id/verification')
  verification(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    if (user.roleCode !== 'OWNER') {
      this.documents.assertCompanyMember(user, id);
    }
    return this.documents.getVerificationStatus(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/verification/submit')
  submitVerification(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.documents.submitForReview(id, user);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch(':id/site-verification/request')
  requestSiteVerification(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RequestSiteVerificationDto,
  ) {
    return this.documents.requestSiteVerification(id, user, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Patch(':id/site-verification/schedule')
  @RequirePermissions('companies.survey')
  scheduleSiteVerification(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ScheduleSiteVerificationDto,
  ) {
    return this.documents.scheduleSiteVerification(id, user.sub, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Post(':id/site-verification/complete')
  @RequirePermissions('companies.survey')
  completeSiteVerification(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.documents.completeSiteVerification(id, user.sub);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/documents/:type/upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  uploadDocument(
    @Param('id') id: string,
    @Param('type') type: CompanyDocumentType,
    @UploadedFile() file: { buffer: Buffer; originalname: string },
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) throw new Error('File wajib diunggah');
    return this.documents.uploadDocument(id, type, file, user);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id/documents/:type/file')
  async downloadDocument(
    @Param('id') id: string,
    @Param('type') type: CompanyDocumentType,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    if (user.roleCode !== 'OWNER') {
      this.documents.assertCompanyMember(user, id);
    }
    const file = await this.documents.readDocumentFile(id, type);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${basename(file.filePath)}"`,
    );
    res.send(file.data);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Patch(':id/documents/:type/review')
  @RequirePermissions('companies.survey')
  reviewDocument(
    @Param('id') id: string,
    @Param('type') type: CompanyDocumentType,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReviewCompanyDocumentDto,
  ) {
    return this.documents.reviewDocument(
      id,
      type,
      dto.approve,
      user.sub,
      dto.rejectReason,
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Post(':id/activate')
  @RequirePermissions('companies.survey')
  activate(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.documents.activateCompanyIfReady(id, user.sub);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id/employees')
  listEmployees(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.companies.listCompanyEmployees(id, user);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id/dispute-report')
  disputeReport(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.companies.disputeSpendReport(id, user);
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
