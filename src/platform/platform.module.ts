import { Module } from '@nestjs/common';
import { PlatformService } from './platform.service';
import { PlatformController } from './platform.controller';
import { EmployeeRecordsModule } from '../employee-records/employee-records.module';
import { CompaniesModule } from '../companies/companies.module';

@Module({
  imports: [EmployeeRecordsModule, CompaniesModule],
  providers: [PlatformService],
  controllers: [PlatformController],
})
export class PlatformModule {}
