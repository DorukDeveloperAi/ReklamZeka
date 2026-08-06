# ReklamZeka ana planı — v1 → v2 revizyonu

## Neden

v1 güvenli read-only MVP'yi kurdu; ancak kullanıcının gerçek ihtiyacı yalnız rapor ve
sabit içgörü değil, kendi kampanya kategorileri/talimatları ve Meta-native parametrelerle
zaman içinde analiz, bütçe planlama ve kontrollü aksiyon yönetimidir.

## Ne korundu

- v1 A01–A06 kapalı kanıtları ve A07 gerçek saha pilotu açık durumu.
- Tenant/role/secret/audit, idempotent ingest, currency/timezone/attribution ve read-only
  connector ilkeleri.
- Deterministik içgörü; LLM'nin karar kaynağı olmaması.

## Ne eklendi

- A08 Meta dijital ikizi ve tam hiyerarşi/config/creative/insights.
- A09 çoklu internal category, isim/özellik mapping ve editable instruction registry.
- A10 zaman serisi, config, category ve action-relative analiz.
- A11 protected allocation ve constraint tabanlı bütçe planlama.
- A12 doğal dil policy taslağı ve kanıt bağlı advisor.
- A13 risk kademeli Meta action valve, scheduler ve agentic routine.
- A14 tek sade kontrol merkezi ve staged rollout.
- Yayındaki reklam metni/dynamic creative/post envanteri; mevcut Instagram/Page gönderisini
  promotion taslağına dönüştürme ve nadir yeni reklam/kreatif draft akışı.
- Planlama otomasyonundan ayrı varsayılan `approval_only` execution lock ve bundle içindeki
  her Meta mutation için atomik approve/reject/request-changes.

## Çelişki düzeltmesi

Eski R-G6 “MVP write yapmaz” hükmü tarihsel v1 için korunur. v2 write yeteneği bu
hükmü sessizce gevşetmez: A13'e kadar writer yok; sonrasında ayrı scope, feature flag,
account allowlist, risk/onay valfi, explicit execute ve read-after-write ile açılabilir.

## Birleştirilen kaynak

`/Users/ybg/dev/meta-adsmanager-ai` projesindeki real Meta client, schema/definition,
deterministic engine, action valve, control plane, advisor ledger, routine ve flow desenleri
keşif girdisidir. Kod otomatik kopyalanmaz; ReklamZeka tenant/security/veri sözleşmesine
uyarlanır ve her parça kendi kabul testinden geçer.
