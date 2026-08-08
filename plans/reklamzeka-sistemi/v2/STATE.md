# REKLAMZEKA SİSTEMİ — STATE (v2)

> Bu dosya ilerleme defteridir; her /goal session'ı bitişte buraya yazar.

## Aşama durumları

| # | aşama | durum | bağımlı | son dokunuş | kanıt |
|---|---|---|---|---|---|
| 01 | temel-kapanis | AÇIK | — | — | — |
| 02 | meta-baglanti-dogrulama | AÇIK | 01 | — | — |
| 03 | sheets-kanon | AÇIK | 01 | — | — |
| 04 | ingest-ambar | AÇIK | 02 | — | — |
| 05 | taksonomi-esleme | AÇIK | 03, 04 | — | — |
| 06 | degerlendirme-digest | AÇIK | 05 | — | — |
| 07 | panel-onayli-yazma | AÇIK | 06 | — | — |
| 08 | butce-danismani | AÇIK | 07 | — | — |
| 09 | creative-tani-metin-kurallari | AÇIK | 07 | — | — |
| 10 | crm-v2-kapisi | AÇIK | 08, 09 | — | — |

## Tur günlüğü (en yeni üstte)

### 2026-08-06 16:05 — hiyerarşi üretimi (session 35fbdca7)
- Yapılan: v2 roadmap tam plan-kur formatında üretildi (Titiz: 1 çerçeve + 10 paralel planlama
  ajanı fan-out). Aynı turda kutup yıldızı yazıldı (utopya/: KUZEY amaç/kapsam + 5 vizyon bölümü
  + istek envanteri, `analiz.mjs --yapi` temiz) ve TODO-ELLE 5 çıpalı maddeyle dolduruldu
  (Kapatır: bağları bu MASTER'da). v1'den taşınan ilerleme: Faz 0 kod ayağı (repo iskeleti,
  terminoloji lint'i, SQLite+Sheets şemaları, taxonomy çözücü + guardrails, 14 test yeşil +
  2 MCP testi token bekliyor) — bu ilerleme aşama-öncesi zemindir, aşama 01 onu kalıcı düzene
  bağlayacak (uv/3.12 + kanit.json + commit kapısı henüz YAPILMADI → 01 AÇIK).
- Kanıt: plans/reklamzeka-sistemi/v2/ (MASTER + STATE + CHECKLIST + REQUIREMENTS + 10 aşama +
  REVIZYON) · utopya/vizyon/1-5 · plans/TODO-ELLE.md · .venv/bin/pytest → 14 passed, 2 skipped.
- Açık kalan / bloker: KULLANICI KARARI — hiçbir aşama ateşlenmedi ("şu an planlama, uygulama
  değil"); ateşleme + otonomi kararı kullanıcı v2'yi görünce. İnsan adımları aşamalara gömülü
  (02 OAuth · 03 Sheets kimliği · 05 tanım/brief girişi · 07 tavanlar+prova onayı · 09 kural
  aktivasyonu · 10 kapı onayı).
