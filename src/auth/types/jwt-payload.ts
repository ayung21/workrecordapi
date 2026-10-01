export interface JwtPayload {
  sub: string;
  publicLoginId: string;
  email: string;
  roleCode: string;
  companyId: string | null;
  permissions: string[];
}
