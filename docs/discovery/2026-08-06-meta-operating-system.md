# Meta reklam işletim sistemi keşfi — 2026-08-06

## Amaç

ReklamZeka'yı kampanya türü, Meta yapısı, kullanıcı iç kategorileri/talimatları,
zaman serisi, bütçe ve kontrollü aksiyonları birlikte anlayan sisteme dönüştürmek.

## Yerel kaynak keşfi

`/Users/ybg/dev/meta-adsmanager-ai` içinde aşağıdaki uygulanmış desenler bulundu:

- Graph v23 real read client; hesap/campaign/adset/ad, creative spec ve 3-level insights.
- Token redaction, debug/scope doctor, cursor, backoff, usage header ve idempotent sync.
- Legacy + outcome objective'ler, campaign/ad-set budget, Advantage+ ve creative raw spec.
- YAML category/mapping/metric/rule/strategy/flow tanımları.
- Deterministik evaluate/plan, risk valfi, approval/executor/audit taslağı.
- Analysis/control/advisor/routine/flow içeren kümülatif v2 planı.

Bu kod doğrudan birleştirilmeyecek; ReklamZeka'nın workspace/role/PostgreSQL/Next
sözleşmelerine port edilmeden önce capability ve güvenlik matrisi çıkarılacak.

## Güvenli canlı kontrol

- `.env` token değeri okunup basılmadı; yalnız mevcut `doctor`/real client içinde kullanıldı.
- Dry-run zorlandı; real client'ta write metodu yoktu.
- Token geçerli, gerekli reklam okuma/yönetim scope'ları mevcut, Graph v23 `/me` canlı
  ve config hesabı erişilebilir bulundu.
- Token veya secret ReklamZeka repo/env dosyasına kopyalanmadı.
- Geniş paralel 30 gün × 3 level + creative çağrısı HTTP 500 “veriyi azalt”;
  küçültülmüş sonraki istek rate-limit verdi. Yeniden zorlanmadı.

## Anonim cache profili

Mevcut daha önce senkronlanmış read-only cache:

| nesne | adet |
|---|---:|
| kampanya | 419 |
| reklam seti | 1.096 |
| reklam | 4.560 |
| kreatif | 4.153 |
| günlük snapshot | 8.385 |

Snapshot dönemi 29 gün; campaign/adset/ad seviyeleri var. Legacy `LINK_CLICKS`,
`MESSAGES`, `LEAD_GENERATION` ile `OUTCOME_*` objective'leri birlikte. Bütçe bazı
kampanyalarda campaign, bazılarında ad-set seviyesinde. Audit satırı yok; gelecekteki
hamlelerin etkisini incelemek için timeline/action ledger zorunlu.

## Meta modelinden alınan kararlar

Meta'nın Campaign dokümanı kampanyayı tek objective etrafında en üst yapı olarak
tanımlar; objective child ad set/ad doğrulamasını etkiler. Campaign alanları arasında
bid strategy, buying type, daily/lifetime/spend cap, special ad categories, status,
budget schedule ve timestamps bulunur. Campaign budget açıksa child ad set'ler ortak
bütçeyi kullanır; budget placement bu nedenle analizin temel bağlamıdır.

Kaynak: [Meta Marketing API Campaign reference](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group).

## Plan etkisi

1. Inventory/creative/insights aynı dev istek değil ayrı stream.
2. Insights level/date slice; breakdown compatibility planlayıcısı ve adaptive page size.
3. Legacy source objective kaybolmadan canonical objective'e mapping.
4. Meta objective tek başına kategori değil; internal categories çoklu overlay.
5. Campaign/adset budget owner resolve edilmeden budget proposal/action yok.
6. Raw instruction doğrudan prompt/action değil; versioned normalized policy draft.
7. Snapshot diff + action ledger + external intervention tek timeline'da.
8. Write capability read connector'dan ayrı ve staged; default dry-run.

## Eksik capability'ler

- ReklamZeka canonical modeli henüz adset/ad/creative ve Meta config alanlarını taşımıyor.
- Reach/frequency/LPV/leads/messages/purchases/action values ve breakdown kataloğu eksik.
- Gerçek token secret reference ReklamZeka runtime'na henüz bağlı değil.
- Canlı sorgu rate-limit düşmeden yeniden koşulmamalı; mevcut cache uygulama fixture'ına
  dönüştürülürken isim/ID/raw URL gibi hassas alanlar anonimleştirilmeli.
