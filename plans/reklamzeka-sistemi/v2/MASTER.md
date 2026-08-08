# REKLAMZEKA SİSTEMİ — MASTER (v2)

> Üretici: /plan-kur · Tarih: 2026-08-06 · Kaynak görev: "planı komple hazırla, devasa şekilde — vizyon, kutup yıldızı, roadmap, planlar, session ve genel todolar (aide hiyerarşisi)"
> Kategori: proje · Üst: —
> Kritiklik: yüksek · Aciliyet: yakın · Hacim: epik
> Hedef: Brief-temelli, kontrol-öncelikli Meta reklam yardımcı ajanı uçtan uca canlı — veri ambarı, brief yargısı, onaylı yazma, bütçe danışmanı, metin kuralları ve CRM kapısı 10 koşulabilir aşamada kanıtlanmış durumda.
> Kapatır: td:elle/meta-mcp-oauth, td:elle/sheets-kimlik, td:elle/python-uv, td:elle/kanit-json, td:elle/master-acik-sorular
> Oturum: ot:2026-08-06/reklamzeka-hiyerarsi-uretimi
> Sürüm: v2 (önceki: v1, değişiklikler REVIZYON.md'de)

## Amaç ve başarı tanımı

v1 (onaylı sistem tasarımı: terminoloji sözlüğü, veri modeli, bileşen mimarisi — orada durur,
buradan referanslanır) koşulabilir formatta değildi; v2 aynı tasarımı 10 aşamalı, kanıt-disiplinli
bir roadmap'e döker. Şartname kökü: `utopya/` (KUZEY + 5 vizyon bölümü). Taşınan güncel kararlar:
digest = ürün + sink kayıt defteri (onay hiçbir sink'ten verilemez) · tek Business Manager ·
Sheets sıfırdan · uv/3.12 onaylı · CRM v2 kapısı son aşama.

**BAŞARI =** 10 aşamanın SONUÇ yüklemi aynı anda doğru: günlük ingest kesintisiz (eksik gün →
alarm kayıtlı), iki zıt İç Kampanya Ailesi brief-gerekçeli skorlanıyor, onaylı yazma zinciri
canlıda kanıtlı ve karar günlüğünden rastgele bir kayıttan tam zincir yeniden kurulabiliyor,
digest tek artefakttan çok-sink dağıtımda, CRM kapanışları Satış rubriğinde — ve
[REQUIREMENTS.md](REQUIREMENTS.md) Global tablosunun tüm satırları PASS.

**Durma kuralı:** (a) bir aşama 3 denemede SONUÇ yüklemini kanıtlayamıyorsa STUCK ilan et ve
eskale et; (b) insan adımı ilan edilip 7 gün yanıtsız kalırsa aşamayı BLOKE işaretle, bağımlı
olmayan aşamaya geç, yoksa dur; (c) aşama 02'de MCP envanteri zorunlu bir yazma aracını
içermiyor çıkarsa 07+ planı DONDURULUR — gateway alternatifi (Pipeboard/SDK) kararı kullanıcıya
sorulur, kendiliğinden geçilmez; (d) herhangi bir guardrail ihlali (onaysız yazma, ACTIVE create)
tespitinde tüm yazma yüzeyi anında durdurulur ve kullanıcıya raporlanır.

## Aşamalar ve bağımlılık grafiği

| # | aşama | SONUÇ (bitince dünya nasıl?) | bağımlı | dosya |
|---|---|---|---|---|
| 01 | temel-kapanis | uv/3.12 ortamında testler yeşil; kanit.json (hizli·tam·surus) kurulu; terminoloji lint'i pre-commit + CI'da zorunlu kapı; iskelet commit'li | — | [asama-01-temel-kapanis.md](asama-01-temel-kapanis.md) |
| 02 | meta-baglanti-dogrulama | mcp-envanter.md canlı dökümle dolu; api-gercekleri 8 teyitsiz maddeden 7'si ölçümle kapalı (madde 4 → 07'ye devirli); MCP testleri token'la yeşil | 01 | [asama-02-meta-baglanti-dogrulama.md](asama-02-meta-baglanti-dogrulama.md) |
| 03 | sheets-kanon | Sheet 11 sekmeyle canlı; sheets_sync Sheets→SQLite cache'i tazeler; append-only disiplin testli | 01 | [asama-03-sheets-kanon.md](asama-03-sheets-kanon.md) |
| 04 | ingest-ambar | Günlük cron 4 seviyede raw+snapshot yazıyor; BUC %80 backoff loglu; eksik-gün alarmı ölçülür; ≥3 gün sürüş kanıtlı | 02 | [asama-04-ingest-ambar.md](asama-04-ingest-ambar.md) |
| 05 | taksonomi-esleme | İki zıt İKA Sheets'te aktif; İK'lar brief'li ve Meta nesnelerine eşli; yetim raporu haftalık; AI iskeleti draft yazıyor | 03, 04 | [asama-05-taksonomi-esleme.md](asama-05-taksonomi-esleme.md) |
| 06 | degerlendirme-digest | Günlük digest artefaktı brief-gerekçeli instance+agrega skorlarla üretiliyor; dosya+Telegram sink'leri bayt-eş; ≥7 gün sürüş | 05 | [asama-06-degerlendirme-digest.md](asama-06-degerlendirme-digest.md) |
| 07 | panel-onayli-yazma | Öneri→panel onayı→PAUSED nesne→geri-okuma→karar günlüğü→rollback zinciri canlıda kanıtlı; dry-run varsayılan; madde 4 kapalı | 06 | [asama-07-panel-onayli-yazma.md](asama-07-panel-onayli-yazma.md) |
| 08 | butce-danismani | Bir İKK'da onaylı bütçe kaydırma döngüsü tamam; etkisi sonraki digest'te raporlu | 07 | [asama-08-butce-danismani.md](asama-08-butce-danismani.md) |
| 09 | creative-tani-metin-kurallari | Yorgunluk tanısı digest'te; block/warn akışı kullanıcı-aktifleştirilmiş kural setiyle uçtan uca testli | 07 | [asama-09-creative-tani-metin-kurallari.md](asama-09-creative-tani-metin-kurallari.md) |
| 10 | crm-v2-kapisi | CRM kapanışları CAPI+lead_id defteriyle Satış rubriğini besliyor; `ölçülemedi` satırları kapalı; genişleme provası belgeli | 08, 09 | [asama-10-crm-v2-kapisi.md](asama-10-crm-v2-kapisi.md) |

Grafik: 01 → (02 ∥ 03) → 04 (02'den) → 05 (03 VE 04) → 06 → 07 → (08 ∥ 09) → 10.
02 ile 03 paraleldir; 08 ile 09 paraleldir. 04/06'nın sürüş kanıtları (≥3/≥7 gün) takvim
gerektirir — sonraki aşamalar kod tarafında erken başlayabilir, kapanışlar sürüşü bekler.

## /goal komutları (fire-and-forget)

Sırayla, her biri ayrı session'da (makine gerçeği: `agac.mjs --durum --json → plans[].goal`):

```
/goal plans/reklamzeka-sistemi/v2/asama-01-temel-kapanis.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz
/goal plans/reklamzeka-sistemi/v2/asama-02-meta-baglanti-dogrulama.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz
/goal plans/reklamzeka-sistemi/v2/asama-03-sheets-kanon.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz
/goal plans/reklamzeka-sistemi/v2/asama-04-ingest-ambar.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz
/goal plans/reklamzeka-sistemi/v2/asama-05-taksonomi-esleme.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz
/goal plans/reklamzeka-sistemi/v2/asama-06-degerlendirme-digest.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz
/goal plans/reklamzeka-sistemi/v2/asama-07-panel-onayli-yazma.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz
/goal plans/reklamzeka-sistemi/v2/asama-08-butce-danismani.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz
/goal plans/reklamzeka-sistemi/v2/asama-09-creative-tani-metin-kurallari.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz
/goal plans/reklamzeka-sistemi/v2/asama-10-crm-v2-kapisi.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz
```

## Global requirements

→ [REQUIREMENTS.md](REQUIREMENTS.md) (tek toplam; burada tekrar edilmez)

## Riskler

- **API sürüm göçü (v26 → sonraki, ~yıllık)** — alan adları kayabilir; sürüm tek konfig sabiti,
  ham JSON saklandığı için `metric_key` eşlemesi güncellenip tarih yeniden türetilir (aşama 04
  provası).
- **MCP araç boşluğu** — creative upload ve bazı yazma araçları teyitsiz; aşama 02 envanteri
  erken uyarıdır, boşluk çıkarsa durma kuralı (c) işler; `meta_gateway.py` soyutlaması sağlayıcı
  değişimini tek modüle sıkıştırır.
- **Tek-MCP bağımlılığı** — beta sonrası fiyat/gating değişebilir; gateway arkasında kalındığı
  sürece geçiş maliyeti sınırlı, karar kullanıcıya eskale edilir.
- **Rate limit (az reklamlı doktor hesaplarında dar BUC kotası)** — %80 eşikli backoff +
  hesap-başına kuyruk + async job; ingest kadansı gerekirse seyreltilir, eksik-gün alarmı
  dürüstlüğü korur.
- **Atıf zayıflığı (takipçi/follows)** — alan adı teyitsiz (aşama 02 maddesi); doğrulanamazsa
  rubrik `derived, güven: düşük` delta-korelasyon modeliyle koşar, digest tahmin basmaz.
- **Sheets kota/çakışma** — batch + append-only yazım, insan hücresi ezilmez; kota aşımında
  SQLite kanon kalır, senkron gecikmeli tamamlanır.
- **Veri birikim bekleme süresi** — aşama 08'in marjinal verimi ≥14 gün snapshot ister; aşama
  06'nın sürüşü erken başlatılarak takvim riski emilir.
- **Uyum sorumluluğu boşluğu** — başlangıç paketi pasif geldiğinden kullanıcı aktive etmezse
  hiçbir metin denetimi koşmaz; tasarım gereğidir ama digest'te "aktif kural sayısı: 0" görünür
  kılınarak sessiz boşluk önlenir.

## İLAN EDİLMİŞ muafiyetler (kapsam dışı, gerekçeli)

- **Meta dışı reklam platformları (Google, TikTok vb.)** — şartname yalnız Meta operasyonunu
  kapsar; gateway soyutlaması ileride kapı bırakır ama v2'de yüzey yok.
- **Otomatik aktivasyon / otonom yayın** — ilke gereği pazarlık dışı (utopya/istek/ilkeler.md);
  aktivasyon her zaman sistem-dışı ayrı insan eylemidir.
- **Hasta/lead kişisel verisi işleme** — KVKK sınırı: MVP yüzeyine PII girmez; CRM kapısında
  bile yalnız hash'li `lead_id` eşlemesi, o da G4.3 revizyonu onaylanmadan kodlanmaz.
- **Çoklu Business Manager senaryosu** — tek BM kararı verili; çoklu-BM yetkilendirme/Advanced
  Access yüzeyi kapsam dışı.
- **Toplu onay** — onay işlem-bazlı ve tek seferliktir; "hepsini onayla" yüzeyi bilinçli yoktur.
- **Panelin ağa açılması / çok kullanıcılı auth** — panel localhost varsayımıyla kurulur;
  ağ-içi erişim gerekirse ayrı karar/plan konusudur (v1 MASTER §10 soru 5).
- **Görsel/video creative üretimi** — sistem yalnız yorgunluk tanısı ve kural-denetimli metin
  önerisi üretir; medya varlığı üretimi kapsam dışıdır.
- **Meta atribüsyonuna dayalı gelir raporu** — CRM kapısına dek CPA/ROAS yalnız piksel-görünür
  alt sınır + `ölçülemedi`; Meta atribüsyonu tek başına gerçek kabul edilmez.
