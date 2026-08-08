# PLAN AĞACI — ReklamZeka

> **ELLE DÜZENLEME YAPMA** — bu dosyayı `plan-organizatoru/scripts/agac.mjs` türetir (tek yazar).
> Damga: `5fec82bef03d` · Kaynak: `plans/*/v*/{MASTER,STATE,CHECKLIST}.md` + `plans/legacy.json`
> Tazelik: `node ~/.claude/skills/plan-organizatoru/scripts/agac.mjs --gate` (damga uyuşmazlığı = bayat INDEX → yeniden türet)

## Ağaç

- **proje** (v2 · SÜRÜYOR · aşama 6/14) — ReklamZeka Meta Reklam İşletim Sistemi `[proje]` `P2`
- **reklamzeka-sistemi** (v2 · AÇIK · aşama 0/10 · sıradaki: 01-temel-kapanis) — REKLAMZEKA SİSTEMİ `[proje]` `P2`

## Planlar

| plan | kategori | künye (kritiklik/aciliyet · hacim) | üst | sürüm | durum | aşamalar | checklist (açık/kapalı) | son tur |
|---|---|---|---|---|---|---|---|---|
| [proje](proje/v2/MASTER.md) | proje | yüksek/normal · epik (P2) | — | v2 | SÜRÜYOR | 6/14 | 101/163 | — |
| [reklamzeka-sistemi](reklamzeka-sistemi/v2/MASTER.md) | proje | yüksek/yakın · epik (P2) | — | v2 | AÇIK | 0/10 | 65/0 | 2026-08-06 16:05 — hiyerarşi üretimi (session 35fbdca7) |

## Öncelik sırası (türev — künye: kritiklik × aciliyet)

1. **reklamzeka-sistemi** — yüksek/yakın · epik (P2) · hedef: Brief-temelli, kontrol-öncelikli Meta reklam yardımcı ajanı uçtan uca canlı — veri ambarı, brief yargısı, onaylı yazma, bütçe danışmanı, metin kuralları ve CRM kapısı 10 koşulabilir aşamada kanıtlanmış durumda.
2. **proje** — yüksek/normal · epik (P2) · hedef: ReklamZeka; Meta portföyünü doğru bağlamda anlayan, kullanıcı

## Nerede kalmıştık

### proje — ReklamZeka Meta Reklam İşletim Sistemi
- Künye: proje · yüksek/normal · epik (P2) · **hedef:** ReklamZeka; Meta portföyünü doğru bağlamda anlayan, kullanıcı
- Kaynak oturum: `ot:2026-08-06/reklamzeka-baslangic`
- Bekleyen: 11-bütçe planlama ⟵ 09, 10 · 13-eylem valfi ve rutin ⟵ 10–12 · 14-kontrol merkezi ⟵ 07, 09–13

### reklamzeka-sistemi — REKLAMZEKA SİSTEMİ
- Künye: proje · yüksek/yakın · epik (P2) · **hedef:** Brief-temelli, kontrol-öncelikli Meta reklam yardımcı ajanı uçtan uca canlı — veri ambarı, brief yargısı, onaylı yazma, bütçe danışmanı, metin kuralları ve CRM kapısı 10 koşulabilir aşamada kanıtlanmış durumda.
- Kaynak oturum: `ot:2026-08-06/reklamzeka-hiyerarsi-uretimi`
- Son tur: **2026-08-06 16:05 — hiyerarşi üretimi (session 35fbdca7)** — v2 roadmap tam plan-kur formatında üretildi (Titiz: 1 çerçeve + 10 paralel planlama
- Sıradaki aşama: **01 — temel-kapanis** (AÇIK)
- Bekleyen: 02-meta-baglanti-dogrulama ⟵ 01 · 03-sheets-kanon ⟵ 01 · 04-ingest-ambar ⟵ 02 · 05-taksonomi-esleme ⟵ 03, 04 · 06-degerlendirme-digest ⟵ 05 · 07-panel-onayli-yazma ⟵ 06 · 08-butce-danismani ⟵ 07 · 09-creative-tani-metin-kurallari ⟵ 07 · 10-crm-v2-kapisi ⟵ 08, 09
- Hazır komut: `/goal plans/reklamzeka-sistemi/v2/asama-01-temel-kapanis.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz`

