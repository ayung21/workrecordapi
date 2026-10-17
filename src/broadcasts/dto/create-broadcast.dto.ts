import { IsIn, IsString, MinLength } from 'class-validator';
import { broadcastAudiences } from '../../database/enums';

export class CreateBroadcastDto {
  @IsString()
  @MinLength(3)
  subject: string;

  @IsString()
  @MinLength(10)
  htmlBody: string;

  @IsIn([...broadcastAudiences])
  audience: (typeof broadcastAudiences)[number];
}
