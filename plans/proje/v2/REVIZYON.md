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
  yayınlanmış PromotionTemplate + ön ayarlı AudiencePreset ile promotion taslağına dönüştürme.
- Yeni creative/metin/medya ve serbest targeting üretmeme sınırı.
- Provider API adapter yerine Codex CLI/VS Code, Claude Code ve ek local AI CLI'ların ortak
  localhost/STDIO MCP, dashboard handoff/session hub ve human-presence companion mimarisi.
- Planlama otomasyonundan ayrı varsayılan `approval_only` execution lock ve bundle içindeki
  her Meta mutation için atomik approve/reject/request-changes.
- Strict-policy-first yaklaşımı iki kanala ayrıldı: doğal dil/scoped/retrievable GuidanceSet
  başlangıç varsayılanı; yalnız enforceable clause replay/impact ile typed policy'ye yükselir.
- Owner yaklaşımı + kaynaklı Meta best-practice + campaign evidence + experiment outcome
  için kritik agentic deliberation, general/group/objective/internal-category/entity/topic
  retrieval ve versioned AnalysisAgenda.
- Decision cadence, learning/cooldown/observation/repeat guard, act/test/observe/no-change ve
  winner/loser/inconclusive experiment ledger ile anti-hyperactivity tasarımı.
- L0–L5 deterministik ön işleme, frozen EffectiveCampaignContext ve context-budget/bounded
  drill-down ile ham veri/token yükünü sınırlayan analiz kanıt pipeline'ı.
- Agentic görüşmelerden versioned AdvisedPractice; outcome-backed trial ve açık
  StandardizationReview ile yalnız uygun parçayı feature/agenda/playbook/guidance/policy'ye
  dönüştürme, sessiz öğrenmeme sınırı.
- Optional manual/CSV business outcome signal, Meta write doğrulamasından ayrı async
  review/delivery durumu, raw retention/disconnect ve in-app scheduled-analysis inbox.
- A08–A14 yatay paketini tek seferde kurmak yerine Meta Read Mirror→Decision Room→Budget
  Lab→approval-only operations→existing-post promotion→selective standardization dikey sırası.
- Modular monolith+PostgreSQL+DB worker başlangıç sınırı; vector DB/warehouse/event bus/
  microservice/canlı CRM/external notification ancak ölçülen ihtiyaç ve ayrı kararla.

## Çelişki düzeltmesi

Eski R-G6 “MVP write yapmaz” hükmü tarihsel v1 için korunur. v2 write yeteneği bu
hükmü sessizce gevşetmez: A13'e kadar writer yok; sonrasında ayrı scope, feature flag,
account allowlist, risk/onay valfi, explicit execute ve read-after-write ile açılabilir.

## Birleştirilen kaynak

`/Users/ybg/dev/meta-adsmanager-ai` projesindeki real Meta client, schema/definition,
deterministic engine, action valve, control plane, advisor ledger, routine ve flow desenleri
keşif girdisidir. Kod otomatik kopyalanmaz; ReklamZeka tenant/security/veri sözleşmesine
uyarlanır ve her parça kendi kabul testinden geçer.
