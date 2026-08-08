# REVIZYON defteri (kümülatif)

> **Kümülatif defter:** v(N+1) dosyası önceki blokları da AYNEN taşır (tek dosya, tüm geçmiş).
> Başlık sözleşmesi (birebir; ayraç em-dash `—`, ISO ts boşluksuz):
> `## r<N> — tip: revize|pivot — <YYYY-MM-DDTHH:mmZ>`

## r1 — tip: revize — 2026-08-06T13:00Z

> Tarih: 2026-08-06 · Talimat: "yani planı komple hazırla, devasa şekilde, biliyorsun aide sisteminin içerisinde belli başlı aşamalar ve görevler var, yani vizyon, kutup yıldızı, roadmap, planlar, session ve genel todolar"

### Neden

v1 el-yazımı bir sistem tasarımıydı (terminoloji + veri modeli + mimari + fazlar) ama plan-kur
formatında değildi: CHECKLIST/REQUIREMENTS/asama-NN dosyaları ve STATE'te `## Aşama durumları`
tablosu yoktu → INDEX'te `asamaToplam: 0`, `goal: null` — plan `/goal`/`planla-kos` ile
KOŞULAMAZDI ve künyesi eksikti (`td:kunye/reklamzeka-sistemi` açık). Kullanıcı tam aide
hiyerarşisi istedi (utopya → roadmap → oturum → TODO). Ayrıca v1 sonrası netleşen kararlar plana
işlenmeliydi: digest = ürün + sink kayıt defteri (onay hiçbir sink'ten verilemez) · tek Business
Manager · Sheets sıfırdan · uv/3.12 onayı · CRM kapısı son aşama.

### Künye değişimi

| alan | v1 | v2 | gerekçe |
|---|---|---|---|
| Kritiklik | — (eksikti) | yüksek | Meta harcama kararlarını besleyen üretim hattı; yanlışta para + mevzuat riski |
| Aciliyet | — (eksikti) | yakın | Faz 0 kod ayağı bitmiş, canlı doğrulama insan adımlarını bekliyor |
| Hacim | — (eksikti) | epik | 10 aşama, ~30 modül/test dosyası, çok haftalı sürüş kanıtları |
| Hedef | — (eksikti) | "Brief-temelli, kontrol-öncelikli Meta reklam yardımcı ajanı uçtan uca canlı…" | v1'de Hedef satırı hiç yoktu; künye tamamlandı |

### Değişenler

| aşama | v1 | v2 | not |
|---|---|---|---|
| (tümü) | 6 "Faz" (0-5), tablo satırı düzeyinde, koşulabilir dosyasız | 10 aşama dosyası (asama-01…10), task/checklist/kanıt disiplinli | yeniden kırıldı |
| Faz 0 | tek faz: temel + doğrulama | 01 temel-kapanis + 02 meta-baglanti-dogrulama + 03 sheets-kanon (paralel) | bölündü |
| Faz 1 | MVP salt-okuma tek faz | 04 ingest-ambar + 05 taksonomi-esleme + 06 degerlendirme-digest | bölündü; digest=ürün/sink modeli eklendi |
| Faz 2 | panel + onaylı yazma | 07 panel-onayli-yazma | PAUSED provası (api-gercekleri #4) buraya devirli |
| Faz 3 | bütçe danışmanı | 08 butce-danismani | ≥14 gün birikim önkoşulu ölçülebilir yazıldı |
| Faz 4 | creative tanı + metin kuralları | 09 creative-tani-metin-kurallari | 07'ye paralel; fail-closed llm_check kuralı eklendi |
| Faz 5 | CRM açık kapısı | 10 crm-v2-kapisi | şartname-önce (G4.3 KVKK) sıra kuralı sertleşti |

### Aynen taşınanlar

v1 MASTER'ın sistem tasarımı bölümleri (terminoloji sözlüğü §1, veri modeli §2, bileşen
mimarisi §3, use-case akışları §4, rubrik tasarımı §5, onay & denetim §6, uyumluluk modülü §7,
riskler §9, açık sorular §10) v1 klasöründe DOKUNULMADAN durur; v2 aşama dosyaları onlara
referans verir. Kod ayağı (src/, config/, docs/, tests/) olduğu gibi zemindir.

### Taşınan ilerleme

v1 STATE "Faz 0 kod ayağı TAMAM (2026-08-06)" kaydı → v2 STATE tur günlüğüne taşındı; aşama 01
AÇIK başlar çünkü v2-aşama-01'in kapsamı (uv/3.12 + kanit.json + commit kapısı) henüz yapılmadı.
Kapanmış checkbox yok (v1'de checklist dosyası yoktu).
