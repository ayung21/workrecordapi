import { Type } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { COMPANY_TERMS_VERSION } from '../constants';
import { CompanyTermsAcceptanceDto } from './company-terms-acceptance.dto';
import { PartnerAccountDto } from './partner-account.dto';

export class RegisterCompanyDto {
  @IsString()
  @MinLength(2)
  companyName: string;

  @IsString()
  @MinLength(8)
  companyPhone: string;

  @IsString()
  @MinLength(2)
  fullName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  personalPhone: string;

  @ValidateNested()
  @Type(() => PartnerAccountDto)
  partnerAccount: PartnerAccountDto;

  @ValidateNested()
  @Type(() => CompanyTermsAcceptanceDto)
  terms: CompanyTermsAcceptanceDto;

  @IsOptional()
  @IsString()
  termsVersion?: string = COMPANY_TERMS_VERSION;
}
