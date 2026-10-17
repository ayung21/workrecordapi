import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EmployeeRecordsService } from './employee-records.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload';

@ApiTags('explore')
@ApiBearerAuth()
@Controller('explore')
export class ExploreController {
  constructor(private readonly records: EmployeeRecordsService) {}

  /** Cari riwayat kerja lintas perusahaan — wajib NIK KTP (16 digit), perusahaan harus aktif. */
  @Get('employee-records')
  searchByNik(
    @CurrentUser() user: JwtPayload,
    @Query('nik') nik: string,
  ) {
    return this.records.searchByNik(user, nik ?? '');
  }
}
