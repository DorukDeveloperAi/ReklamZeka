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
- [ ] **A03** İdempotent kanonik reklam veri akışı.

## Aşama 04 — kiracı güvenliği
- [ ] **A04** Kimlik, üyelik, sır ve audit sınırları.

## Aşama 05 — performans deneyimi
- [ ] **A05** Kaynaklı ve taze dashboard deneyimi.

## Aşama 06 — içgörü motoru
- [ ] **A06** Açıklanabilir, sürümlü öneri motoru.

## Aşama 07 — rapor ve pilot
- [ ] **A07** Paylaşım, geri bildirim, gözlem ve pilot raporu.

## Roadmap kapanışı
- [ ] Tüm aşamalar KAPALI ve kanıt yolları STATE.md'de
- [ ] Hızlı ve tam kanıt sınıfları temiz
- [ ] Pilot başarı ölçütleri raporlandı
- [ ] İlanlı muafiyetler yeniden doğrulandı
