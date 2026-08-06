# REKLAMZEKA SİSTEMİ — REQUIREMENTS (v2)

> Her requirement ölçülebilir bir yüklemdir ve doğrulama yolu yanında yazar.
> `kanit:<giriş>` = `.claude/kanit.json` girişleri (hizli · tam · surus) — defter aşama 01'de
> kurulur; o güne dek bu referanslar "yeni — sınıf: …" hükmündedir ve defteri kurmak aşama 01'in
> T01.2 task'ıdır (çıplak serbest-metin doğrulama YASAK).

## Global

| id | requirement (yüklem) | doğrulama (kanit:<giriş> / yeni-sınıf) | delege |
|---|---|---|---|
| R-G1 | Brief'siz öneri sayısı = 0: her `evaluation` ve `change_proposal` kaydı `brief_id + metric_key + eşik + ölçülen` gerekçesini şema düzeyinde taşır | `kanit:hizli` (şema testi: gerekçesiz insert reddedilir) + `sqlite3 warehouse.db` NULL-brief sorgusu = 0 | uy:brief-yargisi/briefsiz-oneri-yok |
| R-G2 | Her create AÇIK `status=PAUSED` parametresiyle çıkar; `ACTIVE` create/geçiş kod engelli; yazma sonrası geri-okuma sapması alarm üretir | `kanit:hizli` (test_guardrails) + `kanit:surus` (canlı provada geri-okuma PAUSED) | uy:insan-hakimiyeti/paused-garantisi |
| R-G3 | Çıplak terim kullanımı = 0 (kod, Sheets sekme adları, log, prompt şablonları) | `kanit:hizli` (`scripts/lint_terminology.py` exit 0, pre-commit + CI'da zorunlu) | MASTER §1 lint |
| R-G4 | Karar günlüğü append-only ve çift yazımlı: her `applied` kayıt SQLite + Sheets'te eş, silme/güncelleme yolu yok | `kanit:tam` (SQLite↔Sheets satır eşitliği + update/delete reddi testi) | uy:insan-hakimiyeti/karar-gunlugu |
| R-G5 | Dry-run varsayılandır: açık bayrak olmadan koşan `apply` hiçbir MCP yazma çağrısı çıkarmaz, çağrı yalnız loglanır | `kanit:hizli` (dry-run testinde mock gateway'e yazma çağrısı = 0, log satırı > 0) | aşama 07 |
| R-G6 | Digest'te kaynaksız sayı = 0: her metrik `source` taşır, verisi olmayan `ölçülemedi` + neden ile görünür, `derived` güven etiketli | `kanit:tam` (digest JSON şema denetimi) | uy:brief-yargisi/olculemeyen-durustlugu |
| R-G7 | Snapshot sürekliliği: ambarda ardışık gün boşluğu ya yoktur ya da alarm kaydı vardır | `kanit:surus` (günlük boşluk SQL sorgusu + alarm karşılaştırması, haftalık) | uy:veri-gercegi/kayipsiz-ambar |
| R-G8 | Hiçbir sink'ten onay/yazma tetiklenemez: sink adaptörleri salt-okunur, bildirim katmanında onay ucu yok | `kanit:hizli` (sink arayüz testi + adversarial import taraması) | uy:insan-hakimiyeti/digest-urun |
| R-G9 | Her aşama kapanışı kanıt sınıfı koşumuyla mühürlenir ve `agac.mjs --gate` PASS kalır | `kanit:hizli` + `node .claude/skills/plan-organizatoru/scripts/agac.mjs --gate` → PASS | uy:nitelik/gate-temiz |

## Aşama-bazlı

Aşama requirement tabloları TEK KANON olarak her aşama dosyasının `## Aşama requirements`
bölümünde durur — burada kopyalanmaz (çift kanon = sapma riski; bu ilanlı bir sadeleştirmedir):

| aşama | tablo |
|---|---|
| 01 | [asama-01-temel-kapanis.md](asama-01-temel-kapanis.md) §Aşama requirements (R-01.1–R-01.4) |
| 02 | [asama-02-meta-baglanti-dogrulama.md](asama-02-meta-baglanti-dogrulama.md) §Aşama requirements (R02.1–R02.5) |
| 03 | [asama-03-sheets-kanon.md](asama-03-sheets-kanon.md) §Aşama requirements (R-03.1–R-03.5) |
| 04 | [asama-04-ingest-ambar.md](asama-04-ingest-ambar.md) §Aşama requirements (R1–R6) |
| 05 | [asama-05-taksonomi-esleme.md](asama-05-taksonomi-esleme.md) §Aşama requirements (R-05.1–R-05.7) |
| 06 | [asama-06-degerlendirme-digest.md](asama-06-degerlendirme-digest.md) §Aşama requirements (R06.1–R06.8) |
| 07 | [asama-07-panel-onayli-yazma.md](asama-07-panel-onayli-yazma.md) §Aşama requirements (R-07.1–R-07.7) |
| 08 | [asama-08-butce-danismani.md](asama-08-butce-danismani.md) §Aşama requirements (R08.1–R08.6) |
| 09 | [asama-09-creative-tani-metin-kurallari.md](asama-09-creative-tani-metin-kurallari.md) §Aşama requirements (R09.1–R09.7) |
| 10 | [asama-10-crm-v2-kapisi.md](asama-10-crm-v2-kapisi.md) §Aşama requirements (R-10.1–R-10.5) |
