import { Module } from '@nestjs/common';
import { EmployeeRecordsService } from './employee-records.service';
import { EmployeeRecordsController } from './employee-records.controller';
import { ExploreController } from './explore.controller';
import { AccessModule } from '../access/access.module';
import { BlacklistsModule } from '../blacklists/blacklists.module';

@Module({
  imports: [AccessModule, BlacklistsModule],
  providers: [EmployeeRecordsService],
  controllers: [EmployeeRecordsController, ExploreController],
  exports: [EmployeeRecordsService],
})
export class EmployeeRecordsModule {}
