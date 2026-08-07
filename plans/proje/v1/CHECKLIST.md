# ReklamZeka MVP — GENEL CHECKLIST (v1)

> İşaretleme yalnız kanıt komutu beklenen çıktıyı verdiğinde yapılır.

## Aşama 01 — ürün temeli
- [x] **A01** Ürün şartnamesi ve roadmap kanoniktir.
  - [x] T01.1 — Hedef kullanıcı, değer ve MVP sınırı · kanıt: `node scripts/check-project-foundation.mjs`
  - [x] T01.2 — İstek envanteri ve vizyon çıpaları · kanıt: aynı kapı, benzersiz çıpa kontrolü
  - [x] T01.3 — Kanıt sözleşmesi ve ana plan bağı · kanıt: aynı kapı, gerekli dosyalar

## Aşama 02 — teknik temel
- [x] **A02** Çalışan uygulama iskeleti ve mimari kararlar.
  - [x] T02.1 — Stack ADR'ı ve repo yapısı · kanıt: `npm run check:architecture`
  - [x] T02.2 — Uygulama, veritabanı ve test fixture'ı yerelde çalışır · kanıt: `npm run check:quick && npm run build`
  - [x] T02.3 — CI hızlı kapısı aynı komutu koşar · kanıt: `.github/workflows/ci.yml` + architecture kapısı

## Aşama 03 — veri platformu
- [x] **A03** İdempotent kanonik reklam veri akışı.
  - [x] T03.1 — Sürümlü kanonik günlük metrik ve üç kaynak golden fixture'ı · kanıt: `npm run check:data`
  - [x] T03.2 — Salt-okunur connector, cursor, rate-limit, retry ve sınıflı hata sözleşmesi · kanıt: contract suite
  - [x] T03.3 — Resume, replay ve gecikmiş veri idempotency senaryoları · kanıt: ingest suite + Drizzle migration

## Aşama 04 — kiracı güvenliği
- [x] **A04** Kimlik, üyelik, sır ve audit sınırları.
  - [x] T04.1 — Merkezi rol/eylem policy ve çapraz-kiracı negatif matris · kanıt: `npm run check:security-boundaries`
  - [x] T04.2 — AES-256-GCM sır kasası, salt-okunur scope allowlist'i ve redaksiyon · kanıt: secret boundary suite
  - [x] T04.3 — Aktör/zaman/kaynak hash zinciri ve append-only DB trigger'ı · kanıt: audit suite + migration

## Aşama 05 — performans deneyimi
- [x] **A05** Kaynaklı ve taze dashboard deneyimi.
  - [x] T05.1 — Aktivasyon ile boş/kısmi/gecikmiş/hata durum fixture'ları · kanıt: `npm run check:experience`
  - [x] T05.2 — 7/30/90 dönem, kıyas, kanonik toplam ve kampanya drill-down · kanıt: golden suite
  - [x] T05.3 — Ekran okuyucu semantiği ve 1280/820/390 viewport sürüşü · kanıt: `docs/qa/a05-browser-evidence.json`

## Aşama 06 — içgörü motoru
- [x] **A06** Açıklanabilir, sürümlü öneri motoru.
  - [x] T06.1 — Zorunlu kaynak/güven/sürüm şeması ve kural SDK'sı · kanıt: `npm run check:insights`
  - [x] T06.2 — Harcama, dönüşüm, CPA/ROAS ve veri gecikmesi fixture matrisi · kanıt: golden rule suite
  - [x] T06.3 — Kullanıcı/sürüm bağlı idempotent feedback ve audit · kanıt: feedback suite + migration

## Aşama 07 — rapor ve pilot
- [ ] **A07** Paylaşım, geri bildirim, gözlem ve pilot raporu.
  - [x] T07.1 — İmzalı/süreli/iptal edilebilir salt-okunur rapor ve CSV · kanıt: `npm run check:pilot-readiness`
  - [x] T07.2 — Sync/kota/içgörü alarmı, recovery ve runbook'lar · kanıt: operations suite
  - [ ] T07.3 — Gerçek 3 çalışma alanı/10 hesap saha pilotu (`field_pilot`); fixture web yolculuğu, anonim telemetri dönüştürücüsü, attestation ve üretici hazır, gerçek veri bekliyor

## Roadmap kapanışı
- [ ] Tüm aşamalar KAPALI ve kanıt yolları STATE.md'de
- [ ] Hızlı ve tam kanıt sınıfları temiz
- [ ] Pilot başarı ölçütleri raporlandı
- [ ] İlanlı muafiyetler yeniden doğrulandı
