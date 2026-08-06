---
kosum: tek-ajan
---
# ReklamZeka Analiz Platformu — MASTER (v2)

> Tarih: 2026-08-06 · Kaynak istek: kullanıcı tanımlı analiz şablonları, kurallar,
> timeframe, scheduled analysis ve güvenli prompt eklentisi
> Bağımlı: `plans/proje/v1` A03–A06 teknik sözleşmeleri
> Kategori: proje · Kritiklik: yüksek · Aciliyet: normal · Hacim: epik

## Amaç ve başarı tanımı

Kullanıcı, çalışma alanı sınırında kendi analiz tanımını oluşturur; veri dönemi,
karşılaştırma, deterministik kurallar, çalışma takvimi ve isteğe bağlı anlatım talimatını
sürümlü biçimde yönetir. Sistem her çalıştırmayı aynı snapshot ve tanım sürümüne bağlar.

**BAŞARI =** Bir analyst taslak şablon oluşturabilir, geçmiş snapshot üzerinde dry-run
görebilir, yayınlayabilir ve zamanlayabilir. Aynı planlanan tetik iki kez işlendiğinde tek
run oluşur. Deterministik bulgular prompt katmanından önce üretilir; anlatım çıktısındaki
her iddia mevcut `findingId` kanıtına bağlıdır. Tenant sınırı ve reklam hesabına yazmama
ilkesi hiçbir kullanıcı promptuyla değiştirilemez.

## Mimari karar özeti

1. **Analiz tanımı:** `draft → published → archived`; yayınlanan sürüm değişmez.
2. **Kampanya bağlamı:** `objective + funnelStage + optimizationEvent + classificationSource`;
   profile bağlı KPI, diagnostic, guardrail ve karar kılavuzu.
3. **Kural DSL:** Metrik/operator/eşik/minimum hacim allowlist'i; `eval` veya kullanıcı kodu yok.
4. **Timeframe:** Rolling/fixed/calendar tanımı, IANA timezone ve açık karşılaştırma politikası.
5. **Schedule:** Ham cron yerine doğrulanmış hourly/daily/weekly/monthly sözleşmesi; DST,
   misfire ve concurrency politikası tanımın parçasıdır.
6. **Run ledger:** `definitionVersion + scheduledFor + workspaceId` idempotency anahtarı;
   resolved timeframe, snapshot, bulgular ve durum append-only kayda bağlanır.
7. **Prompt eklentisi:** Yalnız `narrative_only`; sabit sistem politikası değişmez. Kullanıcı
   talimatı yapılandırılmış veri alanıdır, araç/SQL/ağ erişimi vermez ve bulgu üretemez.
8. **Aksiyon sınırı:** Sonuç rapor/bildirim üretir; reklam hesabına yazmaz.

## Aşamalar

| # | aşama | sonuç | bağımlı | dosya |
|---|---|---|---|---|
| 01 | analiz sözleşmesi | Şablon, timeframe, kural DSL ve sürüm yaşam döngüsü kanoniktir. | v1 A03–A06 | [asama-01-analiz-sozlesmesi.md](asama-01-analiz-sozlesmesi.md) |
| 02 | scheduler ve run ledger | Zamanlanmış tetikler DST/misfire/idempotency sınırlarıyla çalışır. | 01 | [asama-02-scheduler.md](asama-02-scheduler.md) |
| 03 | prompt anlatım katmanı | Prompt eklentisi yalnız kanıt bağlı anlatım üretir ve injection sınırını geçemez. | 01 | [asama-03-prompt-katmani.md](asama-03-prompt-katmani.md) |
| 04 | ürün yüzeyi | Şablon editörü, dry-run, yayınlama, schedule ve run geçmişi kullanılabilir. | 01, 02, 03 | [asama-04-urun-yuzeyi.md](asama-04-urun-yuzeyi.md) |
| 05 | operasyon ve rollout | Kota, alarm, E2E, migration ve kontrollü açılış kanıtlıdır. | 02, 03, 04 | [asama-05-operasyon-rollout.md](asama-05-operasyon-rollout.md) |

## Kapsam dışı

- Kullanıcının TypeScript/JavaScript/SQL çalıştırması.
- Prompt ile yeni veri kaynağı, araç veya tenant erişimi açılması.
- LLM'nin deterministik bulgu yerine metrik hesaplaması veya hüküm üretmesi.
- Scheduled run sonucunun reklam hesabında otomatik değişiklik yapması.
- İlk sürümde serbest cron ifadesi ve zincirlenmiş çok-adımlı agent workflow'u.

## Riskler

- **Prompt injection:** Kullanıcı talimatı system/developer prompt'a eklenmez; JSON veri alanı,
  sabit çıktı şeması ve `findingId` allowlist'iyle sınırlandırılır.
- **Schedule çoğalması:** Idempotency anahtarı ve workspace concurrency limiti zorunludur.
- **DST ve timezone:** IANA timezone saklanır; olmayan yerel saat `run_once`, çift saat tek
  logical fire olarak işlenir.
- **Yanlış özel kural:** Dry-run, minimum sample guard ve immutable yayın sürümü olmadan aktif olmaz.
- **Maliyet:** Workspace başına run/prompt bütçesi ve narrative kapatma anahtarı bulunur.

## Kanıt

→ [REQUIREMENTS.md](REQUIREMENTS.md) · [CHECKLIST.md](CHECKLIST.md) · [STATE.md](STATE.md)
