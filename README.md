# WorkRecord API

Backend **NestJS + PostgreSQL** untuk platform netral verifikasi riwayat kerja karyawan (komersil), dengan langganan, payment gateway (default **Bima Sakti** stub), audit log, akses lihat berbasis token, role/permission, dan alur approval Admin → Pimpinan.

## Fitur vs requirement

| # | Requirement | Implementasi |
|---|-------------|--------------|
| 1 | CRUD record wajib subscribe + bayar | `AccessService.canCrudRecords` + checkout langganan |
| 2 | ID unik admin saat daftar; ID pimpinan setelah langganan aktif | `POST /companies/register`, `POST /companies/:id/leadership/invite` |
| 3 | ID via email | Admin saat daftar; Pimpinan saat diundang |
| 4–5 | Lihat tanpa login, durasi jam/hari/bulan, token + email link | `POST /view-access/checkout`, grant + email |
| 6 | Subscribe aktif → lihat semua record PT sampai masa habis | `SubscriptionStatus.ACTIVE` + `canViewRecord` |
| 7 | Login tanpa subscribe → hanya yang sudah dibayar | grant `ViewAccessGrant` per user |
| 8 | Tanpa login & tanpa bayar → blur | `visibility: blurred` |
| 9–10 | Admin CRUD butuh approve; Pimpinan langsung live | `RecordChangeRequest` |
| 11 | Ganti password, lupa password, verifikasi email | `POST /auth/*` |
| 12–13 | Owner semua PT; subscriber hanya PT sendiri | role `OWNER` + `companyId` |
| 14–16 | Netral, pengaduan, survey PT | `GET /trust/policy`, `POST /disputes`, survey saat subscribe |
| 17 | PostgreSQL | Prisma |
| 18 | Login ID atau email terverifikasi | `POST /auth/login` |
| 19 | Wajib telepon perusahaan saat daftar | `RegisterCompanyDto.companyPhone` |

## Menjalankan

```bash
cp .env.example .env
docker compose up -d
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

Swagger: `http://localhost:3000/docs`

### Owner seed (default)

- Email: `owner@workrecord.local`
- Password: `OwnerPass123!`

## Alur bisnis singkat

1. **Registrasi PT** — `POST /companies/register` (wajib `companyPhone`). Checkout pembayaran + **ID Admin** ke email.
2. **Pembayaran** — webhook `POST /payments/webhook/bimasakti` (atau midtrans); dev: `POST /payments/:id/mock-complete`.
3. **Survey** — setelah bayar → `PENDING_SURVEY`. Owner: `PATCH /companies/:id/survey` `{ "status": "VERIFIED" }` → langganan aktif + email pengingat undang Pimpinan.
4. **Undang Pimpinan** — hanya jika langganan PT **ACTIVE**: `POST /companies/:id/leadership/invite` (Admin PT). Email berisi ID + link atur password.
5. **CRUD record** — `POST/PATCH/DELETE /companies/:companyId/employee-records` (butuh langganan aktif).
6. **Lihat publik** — `GET /companies/:companyId/employee-records?viewToken=...` atau Bearer JWT + grant aktif.
7. **Beli akses lihat** — `POST /view-access/checkout` → email berisi link token.
8. **Audit log** — `GET /audit-logs?companyId=...` (Admin/Pimpinan PT sendiri; Owner semua PT).

## Payment gateway

Set `PAYMENT_GATEWAY=bimasakti` (default, stub siap diisi API Bima Sakti nanti) atau `midtrans`. Tanpa kredensial, checkout memakai URL mock lokal.

## Struktur modul

- `auth` — JWT, login, password, verifikasi email
- `companies` — registrasi PT, survey
- `employee-records` — CRUD + approval
- `subscriptions` / `payments` / `view-access`
- `access` — aturan blur / full / denied
- `disputes` — pengaduan netral
- `audit` — jejak aktivitas penting (login, pembayaran, CRUD, undang pimpinan, dll.)

## Catatan produksi

- Pasang SMTP dan integrasi Bima Sakti ketika dokumentasi API tersedia.
- Tambahkan rate limiting & audit log sesuai kebutuhan compliance.
