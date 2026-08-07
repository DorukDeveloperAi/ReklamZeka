---
kosum: tek-ajan
---
# Aşama 14 — Sade kontrol merkezi ve kontrollü rollout

## SONUÇ

Kapsamlı model tek sade ürün yüzeyinde yönetilir. Varsayılan görünüm “bugün ne
oldu/ne gerekiyor”; ayrıntılar drill-down ve ileri ayarlardadır.

## Bilgi mimarisi

1. **Bugün:** veri durumu, riskler, bulgular, bekleyen onaylar, bütçe pacing.
2. **Portföy:** business/connection/account-group/account/Page/Instagram asset graph ve
   account→campaign→adset→ad→creative; Meta/iç kategori filtreleri.
3. **Guidance ve Talimatlar:** kritik sohbet, raw owner wording, kaynak/best-practice,
   scoped cards/sets, applied/conflict, progressive policy ve version history.
4. **Analizler:** template/edit/dry-run/publish/schedule/run history.
5. **Bütçe:** envelope, allocation, protected transfer, target, forecast, simulation.
6. **Onaylar:** bundle→action unit, dependency, risk, before/after, creative/post preview,
   spend etkisi, approve/reject/request-changes/expire ve ayrı execute.
7. **Timeline:** sync–policy–finding–plan–action–verify–outcome ve external changes.
8. **Kreatifler:** yayındaki metin/CTA/destination/dynamic varyant, mevcut asset/post,
   bağlamlı performans ve template+audience preset'li existing-post promotion.
9. **Otomasyon/Ayarlar:** planlama modu, approval-only autonomy lock, schedule, run,
   scope, roles, quota, kill switch ve Meta capability.
10. **Yerel AI session'ları:** Codex CLI/VS Code, Claude Code ve ek MCP CLI config/health,
    selected-context handoff, citations/tool trace, proposal ve approval queue correlation.
11. **Practice Lab:** AdvisedPractice candidate/trial/outcome/standardization review ve artifact linkleri.

## Task'lar

### T14.1 — Tasarım sistemi ve progressive disclosure
Default playbook + simple form; ileri selector/DSL açılır panel. Her riskli eylem tek
before/after confirmation; mobilde tablo yerine kart/drill-down.

### T14.2 — Portfolio ve creative explorer
Hiyerarşi, arama/filtre, status/budget owner/objective/category, metrik trend ve config history;
creative preview hassas URL proxy/expiry kurallarıyla read-only. Active ad copy; primary
text/headline/description/caption, CTA/destination, actor, post/media ID ve dynamic
varyantlar ad/adset/campaign performansıyla birlikte görünür.

### T14.3 — Category/instruction studio
Kategori CRUD, selector builder, name mapping preview, manual lock; natural text input,
kritik agent interview, live GuidanceCard paneli, source/scope/topic binding, owner wording
ve agent synthesis; guidance publish kolay, policy promotion semantic diff/replay/impact ister.

### T14.4 — Analysis ve budget studio
Objective/category playbook composition, timeframe/comparison, rules, dry-run; envelope,
allocation, transfer locks, targets ve üçten fazla olmayan bütçe alternatifi. AnalysisAgenda
pass seçici, applied guidance pack, category-by-category görünüm, cadence/experiment history
ve act/test/observe/no-change sonucu progressive disclosure ile görünür.

### T14.5 — Approval, automation ve timeline
Queue bundle'ı atomik satırlara açar; her unit approve/reject/request-changes, dependency,
stale/expiry, before/after, spend etkisi ve execute status taşır. Batch seçim opsiyoneldir;
tek tek karar varsayılandır. Separation of duties, verify/rollback; schedule/run steps;
entity/action/policy filtreli kronoloji ve outcome linkleri.

### T14.6 — Yetki, erişilebilirlik ve browser E2E
Owner/admin/analyst/operator/viewer; tenant negative; keyboard/screen reader; 1280/820/390;
loading/empty/partial/stale/error/conflict/approval/execute states.

### T14.7 — Operasyon ve rollout
Sync/action/advisor run ve context budgets, alerts, deadman, Meta rate headroom, kill switch,
runbooks, feature flags ve staged cohort. Varsa CLI usage/cost telemetrisi opsiyonel ve
istemci-kaynaklıdır; provider faturalaması ReklamZeka sorumluluğu değildir. Rollback
başarısızsa write otomatik kapanır.

### T14.8 — Başarı ölçümü
Classification correction, policy conflict, useful finding, proposal acceptance, prevented
unsafe action, verify/rollback, operator time saved ve spend-impact; vanity LLM metriği yok.

### T14.9 — Çok hesap ve asset kontrolü
Account-group switcher, connection health/scope, Page/Instagram/pixel/destination edges,
currency/timezone/capability ve hesap bazlı sync/action durumları. Toplu görünüm tenant
ve account permission'ı aşmaz.

### T14.10 — Yerel AI session ve eylem kontrol paneli
Codex CLI/VS Code, Claude Code ve ek MCP istemcileri için kurulum/config, bağlantı/health,
last-seen, workspace/account scope, selected dashboard context handoff ve tool/citation/
proposal trace. ReklamZeka provider API key istemez. Campaign/adset/ad status ile campaign/
adset budget before-after; approve/reject/execute/verify/rollback ayrı yetki ve UI adımları.

### T14.11 — Şablonlu existing-post promotion sihirbazı
Bağlı Instagram/Page post-media seçici; ownership/promotion capability ve preview;
internal kategori/talimatla eşleşen yayınlanmış PromotionTemplate ve frozen AudiencePreset;
mevcut/yeni campaign-adset hedefi, bütçe ve destination özeti. Action bundle post identity,
template+audience, hedef yapı, bütçe, create/publish ve activate unit'larını ayrı gösterir.
Yeni metin/görsel üretme veya serbest targeting alanı yoktur.

### T14.12 — Otonomi kontrolü
Planlama otomasyonu ile execution autonomy yan yana fakat ayrı görünür. Default
`approval_only`, aktif scope override, kim/ne zaman yayınladı, kill switch ve izin verilen
risk sınıfları gösterilir. Gevşetme ayrı yetkili confirmation/policy publish ister;
zaman aşımı fail-closed kalır.

### T14.13 — Practice Lab ve standardization review
Practice scope/steps/evidence/cadence/exceptions; trial vakaları ve outcomes; validated/
conditional/rejected hükmü. Review, feature/agenda/playbook/guidance/policy/human-judgment
decomposition'ını ve her standardized artifact diff/linkini gösterir. Tek tık sessiz rule yoktur.

### T14.14 — In-app analysis inbox
Scheduled/manual analysis run sonucu Today/inbox'a idempotent card olarak düşer; unread/read/
acknowledged, stale/superseded ve deep-link taşır. İlk incrementte e-posta/Slack/webhook yok;
external channel ayrı capability/rollout kararıdır.

### T14.15 — Operating Dashboard ana kabuğu
Kalıcı navigation: Today/decision queue, campaign context, scheduled analysis, budget lab,
rules/playbooks, Orchestrator, approval inbox ve timeline. Summary-first görünüm veri
freshness/coverage, effective autonomy, öncelikli kararlar ve bütçe durumunu ilk ekranda
gösterir; derin ayarlar progressive disclosure'dır.

### T14.16 — Orchestrator çalışma alanı
Aktif Codex/Claude/diğer MCP session health, selected context/handoff, skill pack, tool ve
citation trace, effective autonomy matrisi, konuşma/draft/proposal correlation. Dashboard
conversation transcript'i policy state saymaz; kalıcı değişiklik typed draft/version üretir.

## Kabul ve kanıt

- Kullanıcı bir kampanyayı bulur, category/instruction ekler, dry-run analiz ve bütçe
  simülasyonu görür, schedule eder ve approval sonucunu timeline'da izler.
- Viewer mutasyon yapamaz; analyst execute edemez; operator policy publish edemez.
- 1280/820/390 ve keyboard E2E; console error 0; token/raw payload istemciye sızmaz.
- Shadow/dry-run pilot KPI raporu olmadan production write cohort genişlemez.
- En az iki account + Page/Instagram asset bağlamında filtre/sync/analysis ayrıdır.
- Dashboard, Codex ve Claude aynı proposal'ı application action queue'da gösterir; hiçbiri valfi atlamaz.
- Dashboard ve local CLI session aynı proposal ID/şablon/audience snapshot'ını görür;
  ReklamZeka process'i provider model API'si çağırmaz.
- Kullanıcı existing-post bundle'ında yalnız istediği satırları onaylar; bağımlı ama
  onaysız satır uygulanmaz ve toplu onay varsayılan değildir.
- Approval-only kilidi açıkken scheduled-plan öneri üretir fakat hiçbir Meta write çalıştırmaz.
- Kullanıcı sohbetle global/category/topic guidance set oluşturur, historical rehearsal'da
  aşırı uyarı/hamle sayısını görür ve yalnız seçili clause'u hard policy'ye yükseltir.
- Bir AdvisedPractice outcome ile trial edilir; standardization review practice'in yalnız
  uygun parçasını agenda/feature yapar, business nuance guidance olarak kalabilir.
- Scheduled run bir kez in-app inbox'a teslim edilir; duplicate fire duplicate card üretmez.
