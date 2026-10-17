import { Equals, IsBoolean } from 'class-validator';

export class CompanyTermsAcceptanceDto {
  @IsBoolean()
  @Equals(true)
  companyInfoTrue: boolean;

  @IsBoolean()
  @Equals(true)
  authorizedRepresentative: boolean;

  @IsBoolean()
  @Equals(true)
  masterResponsibility: boolean;

  @IsBoolean()
  @Equals(true)
  termsAndPrivacy: boolean;
}
