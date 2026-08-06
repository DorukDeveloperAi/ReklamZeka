# Model-agnostic yerel AI CLI, MCP ve dashboard mimarisi

## Amaç

ReklamZeka; deterministic reklam motorlarını modele bağlamadan kullanıcının kurulu Codex
CLI/VS Code, Claude Code veya başka AI CLI session'ından yönetilebilir. Uygulama OpenAI/
Anthropic model API'si çağırmaz ve provider API key'i saklamaz. CLI kendi login/subscription
oturumunu kullanır; Meta Graph bağlantısı ayrı connector sınırıdır.

## Katmanlar

```text
Dashboard / Local companion CLI       Codex CLI / VS Code      Claude Code      Other CLI
              |                                 |                    |              |
       App read/action API              local MCP client ------+------+--- MCP/adapter
              |                                 |              |
              +------- Auth + tenant tool broker + session/handoff ledger
                                      |
                   read tools --------+-------- draft/proposal tools
                                      |
         Sync | Category | Policy | Analysis | Budget | Timeline engines
                             (model SDK/API yok)
                                      |
                    HumanPresenceGrant + Approval Valve
                                      |
                         Typed Meta Read/Write adapters
```

## Core ve no-model-API sınırı

Sync, category/effective context, policy, timeframe/metric/finding, budget, promotion
template resolution, action eligibility/risk/approval, scheduler ve timeline paketleri
model SDK'sı import etmez. ReklamZeka runtime'ında `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
ve provider Responses/Messages çağrısı yoktur. Modelsiz fixture client tüm deterministic
akışı CI'da çalıştırır.

Yerel Codex/Claude Code ürünleri kendi servisleriyle haberleşebilir; bu trafik ve kimlik
bilgisi ilgili CLI'nın sorumluluğudur, ReklamZeka'nın model entegrasyonu değildir.

## Neden MCP-first

MCP, farklı yerel agent istemcilerine aynı read/proposal araçlarını verir. Codex'in aynı
hosttaki desktop, CLI ve IDE extension yüzeyleri STDIO ve Streamable HTTP MCP'yi destekler
ve MCP yapılandırmasını paylaşır. Bu nedenle bir kez project/global config eklemek açık
Codex CLI veya VS Code session'ından ReklamZeka araçlarını kullanmak için yeterlidir.
[Codex MCP manual](https://learn.chatgpt.com/docs/extend/mcp)

Claude Code da aynı ReklamZeka MCP server'ına bağlanır; vendor-specific prompt veya domain
fork'u oluşmaz. [Claude MCP documentation](https://docs.anthropic.com/en/docs/mcp)

Bir dashboardun açık, rastgele CLI terminalini kontrol etmesi standart değildir. Bu yüzden
session-first entegrasyonda CLI ReklamZeka MCP'ye bağlanıp kendini kaydeder. Dashboard-first
akışta uygulama context handoff üretir veya dedicated CLI process başlatır; mevcut TTY
hijack edilmez. Codex App Server mümkün olsa da resmi manual onu gelişim/debug için
deneysel saydığı için temel sözleşme yapılmaz. [Codex CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli)

## Yerel bağlantı biçimleri

1. **Project STDIO MCP:** CLI ReklamZeka server komutunu child process olarak başlatır;
   tek proje ve kısa ömürlü session için basit yol.
2. **Localhost Streamable HTTP MCP:** dashboard ve birden fazla açık CLI aynı çalışan yerel
   ReklamZeka instance'ına bağlanır; loopback dışında varsayılan bind yoktur.
3. **LocalCliAdapter:** MCP desteklemeyen CLI için opsiyonel dedicated subprocess; yalnız
   allowlist binary, sabit arg template, cwd, health ve lifecycle. Arbitrary shell/env dump yok.

## Session ve handoff sözleşmesi

`AgentSession`: client kind/version, transport, workspace/account scopes, OS user, started/
lastSeen, status, capabilities ve audit correlation taşır. `DashboardHandoff`: seçili entity,
timeframe, analysis/promotion intent, internal categories, template candidate, expiry ve
tek kullanımlık nonce taşır.

Araçlar:

- `register_agent_session`, `heartbeat_agent_session`, `get_handoff_context`;
- `get_workspace_context`, `search_entities`, `get_entity_context`;
- `list_live_ad_creatives`, `list_promotable_posts`, `get_creative_preview`;
- `list_promotion_templates`, `get_audience_preset`, `preview_post_promotion`;
- `resolve_effective_policies`, `run_dry_analysis`, `get_findings`, `get_timeline`;
- `get_effective_campaign_context`, `get_metric_drivers`, `compare_timeframes`;
- `compare_category_cohort`, `get_pre_post_action`, `get_business_outcome_signals`;
- `search_guidance`, `get_effective_guidance_pack`, `get_analysis_agenda`;
- `get_decision_cadence`, `get_experiment_history`, `draft_guidance_set`;
- `list_advised_practices`, `draft_advised_practice`, `draft_standardization_review`;
- `promote_guidance_to_policy` (yalnız gated taslak/impact preview);
- `get_budget_state`, `simulate_budget_plan`, `get_action_status`;
- `draft_instruction_policy`, `propose_category_assignment`;
- `create_budget_plan_proposal`, `create_existing_post_promotion_proposal`;
- `create_action_proposal`, `request_human_approval`.

Agent L4/L5 kompakt context ile başlar. L1–L3'e yalnız tenant-scoped, typed ve bütçeli
drill-down araçlarıyla iner; L0 raw payload/dump aracı yoktur. `moreAvailable`, truncation
nedeni ve context version/hash görünürdür.

Yeni creative/metin üretme, asset upload, raw Graph, token read veya writer tool'u yoktur.
Promotion proposal yalnız yayınlanmış `PromotionTemplate + AudiencePresetVersion` seçer;
agent targeting spec oluşturamaz/değiştiremez.

Guidance retrieval önce deterministic tenant/scope/topic filtresi, ardından bounded
relevance ranking kullanır. Natural-language guidance analiz ve proposal framing'ine
girebilir; hard constraint veya approval/action authorization'a yalnız typed G3 policy
olarak yükseltildikten sonra girer. Agent official Meta best-practice iddiasını sourceRef/
freshness olmadan üretemez ve her tur act/test/observe/no-change seçeneklerini değerlendirir.
Agent sohbetten AdvisedPractice taslağı çıkarabilir; outcome doğrulaması, standardization
review ve kullanıcı yayını olmadan bunu feature, agenda, policy veya automation'a çeviremez.

## Dashboard session hub

Dashboard; CLI config yönergesi, connection health, last-seen, workspace/account scope,
selected-context handoff, tool/citation trace, proposal ve run durumunu gösterir. “CLI'da
devam et” butonu handoff üretir; açık session bunu MCP ile çeker. Session'dan oluşan proposal
aynı application inbox ve timeline'da görünür. Conversation memory kalıcı policy/template/
approval state'in kaynağı değildir.

## Session içinden insan onayı

Agent tool çağrısı insan onayı değildir. Dashboard veya yerel `reklamzeka approve/execute`
companion komutu gerçek TTY + passkey/OS confirmation sonrası tek action unit, spec hash ve
expiry'ye bağlı `HumanPresenceGrant`ı doğrudan uygulamaya gönderir. Grant model context'ine
dönmez; CLI yalnız receipt görür. Böylece kullanıcı terminal akışından çıkmadan tek tek
onaylayabilir, fakat agent kendi kendini onaylayamaz.

MCP ilk rollout'ta `approve_action` veya `execute_action` model tool'u sunmaz. Approval-only
lock, human-presence ve A13 action valve birbirinden bağımsız üç kapıdır.

## Conformance testleri

1. Codex CLI/VS Code, Claude Code ve fixture client aynı tool/schema setini görür.
2. Aynı frozen contextte finding, template resolution, budget ve action eligibility aynıdır.
3. ReklamZeka model-provider API key/env/SDK/network çağrısı taşımaz.
4. Cross-workspace handoff, raw writer, serbest targeting ve hidden approval tool reddedilir.
5. Session proposal'ı dashboardda aynı ID ve atomik action unit'larla görünür.
6. HumanPresenceGrant yalnız kullanıcı companion/UI yolundan ve tek unit/spec için geçerlidir.
7. AI CLI kapalıyken scheduled deterministic analysis/plan/approval queue çalışır.
8. L0 raw erişimi reddedilir; aynı frozen EffectiveCampaignContext client'tan bağımsızdır.
9. AdvisedPractice taslağı sessizce standardize/publish edilemez.
