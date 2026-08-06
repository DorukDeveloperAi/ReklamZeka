# ReklamZeka Meta Reklam İşletim Sistemi — STATE (v2)

> Kümülatif ilerleme defteri. v1'in ayrıntılı tur geçmişi
> [v1 STATE](../v1/STATE.md)'te değişmeden korunur.

## Aşama durumları

| # | aşama | durum | bağımlı | kanıt / açık iş |
|---|---|---|---|---|
| 01 | ürün temeli | KAPALI | — | `check:foundation` |
| 02 | teknik temel | KAPALI | 01 | `check:quick`, build, security |
| 03 | veri platformu | KAPALI | 02 | `check:data` |
| 04 | kiracı güvenliği | KAPALI | 02 | `check:security-boundaries` |
| 05 | performans deneyimi | KAPALI | 03,04 | `check:experience` + browser QA |
| 06 | içgörü motoru | KAPALI | 03,04 | `check:insights` |
| 07 | rapor ve saha pilotu | DEVAM | 05,06 | fixture hazır; gerçek 3 workspace/10 hesap kanıtı son kapanışta alınacak; A08'i engellemez |
| 08 | Meta dijital ikizi | AÇIK | 03,04 | live/cached discovery tamam; connector/schema uygulaması sırada |
| 09 | kategori ve talimat | AÇIK | 08 | requirement/precedence tasarımı tamam; uygulama sırada |
| 10 | zamansal analiz | DEVAM | 06,08,09 | objective schema/playbook temeli var; tam motor sırada |
| 11 | bütçe planlama | AÇIK | 09,10 | planlandı |
| 12 | prompt/advisor | DEVAM | 09–11 | narrative envelope/claim guard temeli var; translator/ledger sırada |
| 13 | eylem valfi ve rutin | AÇIK | 04,10–12 | planlandı; write kapalı |
| 14 | kontrol merkezi | AÇIK | 07,09–13 | planlandı |

## 2026-08-06 — ana plan konsolidasyonu ve Meta keşfi

- Düzeltme: analiz kapsamı paralel mini-v2 olmaktan çıkarıldı; v1'in A01–A07
  zincirini miras alan tek kümülatif v2 ana plana dönüştürüldü.
- Kullanıcı ihtiyacı: Meta hiyerarşisi, çoklu internal kategori, isim/özellik mapping,
  editable talimat registry, objective/category-aware zaman analizi, protected budget,
  prompt/advisor, instant+scheduled routines, controlled action ve tek dashboard.
- Yan proje `/Users/ybg/dev/meta-adsmanager-ai` incelendi: real read client, hierarchy,
  creative raw spec, 3-level insights, rule/flow, valve/audit desenleri yeniden kullanılabilir.
- Token değeri gösterilmeden `doctor` smoke: geçerli; Graph v23 `/me` ve config hesabı
  erişilebilir; dry-run ve writer kapalı. Token ReklamZeka dosyalarına kopyalanmadı.
- Canlı geniş sorgu Meta `reduce amount of data`, sonra request-limit verdi. Karar:
  inventory/creative/insights ayrı stream; level/date slice; usage headroom/adaptive page.
- Mevcut gerçek cache anonim kapsamı: 419 campaign, 1.096 ad set, 4.560 ad,
  4.153 creative, 8.385 daily snapshot; legacy ve outcome objective'ler birlikte.
- Mevcut cache'te audit 0; bu nedenle gelecekteki her internal/external hamle için tek
  append-only timeline ve snapshot-diff zorunlu.
- Kaynaklar: [keşif raporu](../../../docs/discovery/2026-08-06-meta-operating-system.md),
  ADR-0008/0009/0010, `npm run check:analysis-platform`.

## 2026-08-06 — çok hesap ve model-agnostic hibrit işletim

- Workspace→business connection→account group→ad account ile Facebook Page/Instagram/
  pixel-dataset/app/WhatsApp destination asset graph'ı A08'e eklendi. Hesap currency,
  timezone, permission, capability, cap, rate-limit ve action sonucu ayrı kalır.
- Status eylemleri campaign/adset/ad; budget eylemleri yalnız gerçek budget owner campaign/
  adset seviyesidir. Ad-level budget strict şema hatası; activate parent/effective status,
  review/issues ve schedule eligibility ister.
- Core motorlar modelsiz; `AgentProvider` ile OpenAI/Anthropic adapter, dashboard agent
  console ve vendor-neutral Streamable HTTP MCP server A12 kapsamına alındı.
- Codex/Claude MCP read ve draft/proposal tools kullanabilir; raw Meta writer/execute tool
  alamaz. Approval ve execute application role + A13 valfi + ayrı worker'da kalır.
- Manual, assisted, automated-read ve policy-automated modlar tanımlandı. Yalnız explicit
  izinli/cap'li K1/K2 policy-otomatik; K3 artış/activate ve K4 yapısal insan onaylı.
- Kaynaklar: [model-agnostic mimari](../../../docs/architecture/model-agnostic-agent-interface.md),
  ADR-0011 ve resmi Codex/Anthropic MCP dokümanları.

## 2026-08-06 — kategori-aware analiz temeli

- `src/analyses/schema.ts`: objective/funnel/optimization/classification, timeframe/schedule,
  safe rule DSL ve narrative configuration.
- `src/analyses/objective-playbooks.ts`: altı objective için KPI/diagnostic/guardrail/
  min-sample/evaluation/decision guide; cross-objective guard.
- `src/analyses/prompt-envelope.ts`: user guidance untrusted data; finding-bound output.
- Kanıt: 62 test, typecheck, DB check, production build, audit 0 zafiyet; plan gate temizdi.

## 2026-08-06 — creative/post ve atomik otonomi valfi plan revizyonu

- A08 live ad copy/spec modeline primary text/headline/description/caption, CTA,
  destination, actor, post/media identity ve dynamic varyant provenance eklendi.
- Bağlı Instagram/Page gönderisini mevcut veya yeni uygun ad-set yapısında öne çıkarma,
  ownership/capability/preflight ile K4 typed action bundle olarak A13'e alındı.
- Düzeltme: yeni reklam/kreatif üretimi yapılmayacak. Yalnız yayındaki metin okunur ve
  mevcut post frozen identity/content ile şablonlu promotion'a referans olur.
- PromotionTemplate + immutable AudiencePreset internal category/account/actor/post
  selector'ıyla resolve edilir; agent hedef kitle veya creative üretemez.
- Planlama modu execution autonomy'den ayrıldı. Varsayılan/ilk rollout `approval_only`;
  K1–K4 her write action unit tek tek onaylanır, expiry veya child scope yetkiyi genişletmez.
- Bundle gruplama/dependency yüzeyidir; authorization ve audit atomik action unit'tadır.
  Kaynaklar: ADR-0012 ve `docs/architecture/creative-and-approval-operations.md`.

## 2026-08-06 — dashboard ile ortak yerel AI CLI session modeli

- Provider API adapter kapsamdan çıkarıldı. ReklamZeka OpenAI/Anthropic model API key'i
  saklamaz/çağırmaz; Meta Graph connector ayrı kalır.
- Codex CLI/VS Code, Claude Code ve ek MCP-capable CLI kendi login/session'ıyla localhost
  Streamable HTTP veya project STDIO ReklamZeka MCP'ye bağlanır.
- Dashboard local session hub; config/health, selected entity/timeframe handoff, tool/citation,
  proposal ve action queue correlation gösterir. Açık session aynı backend state'ini kullanır.
- Session içi insan onayı model tool'u değildir; local companion TTY/passkey ile tek
  ActionUnit/spec'e bağlı HumanPresenceGrant üretir. Kaynaklar: ADR-0011 ve
  `docs/architecture/local-cli-agent-bridge.md`.

## Sıradaki uygulama

**A08/T08.1–T08.3:** secret reference kararı, Meta entity/config şeması ve budget-owner
resolver. A13'e kadar production write scope veya writer ReklamZeka'ya taşınmaz.
