import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('trust')
@Controller('trust')
export class TrustController {
  @Public()
  @Get('policy')
  policy() {
    return {
      neutralParty: true,
      summary:
        'WorkRecord adalah pihak ketiga netral. Kami tidak berpihak pada perusahaan atau individu.',
      disputeProcess:
        'Pengaduan dapat diajukan via POST /disputes. Tim kami akan menghubungi PT terkait untuk verifikasi.',
      subscriptionSurvey:
        'Setiap langganan baru memicu survey verifikasi ke PT (nomor telepon perusahaan wajib saat registrasi).',
      dataIntegrity:
        'Perubahan oleh Admin memerlui persetujuan Pimpinan; perubahan oleh Pimpinan langsung aktif.',
    };
  }
}
