# Meta API Gerçekleri — araştırma damgası 2026-08-06

Kaynak: planlama oturumu web araştırması (MASTER "Araştırma temeli"). Bu dosya
Faz 0 canlı doğrulamasının kontrol listesidir; her teyitsiz madde canlı hesapta
ölçülüp kapatılır.

## Doğrulanmış (2026-08-06)

- Marketing API güncel sürüm **v26.0** (29 Tem 2026); sürüm ömrü ~1 yıl; v26
  kırıcı değişiklikleri 27 Eki 2026'da tüm sürümlere yayılır.
- Attribution pencereleri: yalnız **1d/7d click + 1d view** (Oca 2026'dan beri).
- Veri saklama: unique/saatlik **13 ay**, frequency kırılımı **6 ay**, toplamlar
  37 ay → kendi ambarımız (warehouse.db) zorunlu; "Meta'dan tekrar sorarım" yok.
- Offline Conversions API **öldü** (14 May 2025) → CRM geri beslemesi yalnız
  Conversions API + dataset + `lead_id` (v2 kapısı).
- Advantage+ birleşik yapı tamam; salt-okunur `advantage_state_info`
  (ADVANTAGE_PLUS_SALES/APP/LEADS/DISABLED). Manuel yapı hâlâ mümkün (DISABLED).
- IG postunu API'den reklamlaştırma resmî: `POST /act_X/adcreatives` +
  `source_instagram_media_id` (foto/video/carousel/reel/aktif story).
- Rate limit: BUC modeli, saatlik, hesap başına; `X-FB-Ads-Insights-Throttle`
  başlığı; büyük sorgular için async job (`report_run_id`). %80 eşikte backoff.
- Insights 4 seviye: account/campaign/adset/ad (Meta uçları). <!-- term-ok: Meta uç adları -->
- Resmî Meta Ads MCP: Nis 2026 açık beta (reklamveren OAuth yolu), Tem 2026
  geliştirici yolu; beta'da ücretsiz; "MCP server rules" ile hesap düzeyi kısıt.

## TEYİTSİZ — Faz 0'da canlı hesapta doğrula

| # | Madde | Nasıl doğrulanır | Sonuç |
|---|---|---|---|
| 1 | Resmî MCP tekil araç adları + yazma araçlarının parametre yüzeyi | `MetaGateway.list_tools()` → docs/mcp-envanter.md | ⬜ |
| 2 | "Instagram follows" metriğinin Ads Insights'taki alan adı/action_type | test reklamı insights çekimi, actions listesi dökümü | ⬜ |
| 3 | `video_thruplay_watched_actions` alan adının v26 geçerliliği | aynı çekimde alan varlığı | ⬜ |
| 4 | Resmî MCP'de create'in PAUSED garantisi | Faz 2 öncesi tek test nesnesi + geri-okuma (güvenilmeyecek; kod engeli zaten var) | ⬜ |
| 5 | Uygulama-içi boost'un ad account'taki yapısı (ad kalıbı, objective, creative bağı) | mevcut boost'lu hesapta nesne dökümü | ⬜ |
| 6 | Resmî MCP'de creative/görsel upload aracı var mı | envanter dökümü (#1) | ⬜ |
| 7 | "Profile visits from ads" — hangi uçtan, hangi alanla | IG Platform insights + ads insights karşılaştırma | ⬜ |
| 8 | Sağlık kategorisi kısıtlarının hesaba etkisi (alt-huni event kısıtı) | dataset/sinyal tanılama araçlarıyla kontrol | ⬜ |

## Tasarım kancaları

- API sürümü tek konfig noktası: `config/settings.yaml → meta.api_version_note`.
- Ham insights JSON `raw_insights` tablosunda saklanır → alan adı değişince
  `metric_snapshot` geriye dönük yeniden türetilebilir.
- Metrik adları `metric_key` soyutlamasıyla eşlenir (organik metrik kıyımı:
  reach/impressions ailesi → Views/Viewers ailesi geçişi).
