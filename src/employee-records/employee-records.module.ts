import { Module } from '@nestjs/common';
import { EmployeeRecordsService } from './employee-records.service';
import { EmployeeRecordsController } from './employee-records.controller';
import { AccessModule } from '../access/access.module';

@Module({
  imports: [AccessModule],
  providers: [EmployeeRecordsService],
  controllers: [EmployeeRecordsController],
})
export class EmployeeRecordsModule {}
