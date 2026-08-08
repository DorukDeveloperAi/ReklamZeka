# Yerel AI CLI session bridge sözleşmesi

## Ürün davranışı

Kullanıcı aynı işi iki yüzeyden sürdürebilir:

- dashboarddan entity/post/template seçip analiz veya proposal hazırlamak;
- açık Codex CLI/VS Code, Claude Code ya da ek MCP CLI session'ında doğal dille aynı
  ReklamZeka context/tools üzerinden çalışmak.

İki yüzey aynı veritabanı, run, proposal, action unit, approval ve timeline kayıtlarını
kullanır. Session çıktısı dashboarda kopyalanmaz; zaten aynı backend'e ID ile yazılır.

## Kurulum modeli

- Dashboard “AI CLI bağla” ekranı client türü seçtirir ve project-scoped MCP config/health
  adımlarını sunar.
- Codex aynı hosttaki desktop, CLI ve VS Code yüzeylerinde ortak MCP config kullanabilir;
  ReklamZeka bir kez eklenir. CLI kendi ChatGPT login'ini korur.
- Claude Code kendi MCP config ve login state'ini korur.
- ReklamZeka bu login dosyalarını veya provider API key'lerini okumaz.
- Bilgisayar ve yerel ReklamZeka instance'ı kapalıysa session bridge çalışmaz; scheduled
  local rutinler de bir sonraki açılışa kadar `deferred_local_offline` olur.

## Dashboard → session handoff

1. Kullanıcı dashboardda account/campaign/ad/post ve timeframe seçer.
2. “CLI'da devam et” kısa ömürlü `HandoffContext` üretir.
3. Açık session `get_handoff_context` ile aynı seçimi, ardından frozen
   `EffectiveCampaignContext` özetini alır.
4. Agent L4/L5 kanıtla başlar; gerekirse bounded L1–L3 drill-down yapar ve analiz/promotion
   template seçeneklerini okuyup proposal üretir.
5. Proposal dashboard inbox'ta aynı correlation ID ile görünür.

Handoff veri snapshot'ı değil, scoped referans ve version setidir. Session her aracı
çağırdığında tenant/role/stale kontrolü yeniden yapılır.

Application çekirdeği register, server-clock heartbeat ve 15–120 saniyelik atomik
tek-kullanımlık handoff lifecycle'ını tanımlar. Capability claim seti ile agent descriptor;
session, workspace, kullanıcı, client, transport, tool catalog ve expiry boyunca exact bağlıdır.
Target aynı kullanıcı/workspace'te olmalı ve intent için gereken safe tool'a sahip olmalıdır.
PostgreSQL repository session ve ref-only handoff'u restart-durable saklar; active workspace kilidi,
composite session FK'leri, atomik consume, RLS/grant kapısı ve tombstone purge ile sınırlar.
Authenticated local HTTP koordinasyonu dashboard cookie'siyle session list/register ve handoff create;
CLI bearer capability'siyle register/heartbeat/consume sunar. Dashboard yalnız API'dan aktif session
doğrulanınca bağlı durum gösterir; tek hedefi otomatik, birden fazlasını açık seçimle ele alır.
Project STDIO MCP bu çekirdeği artık 3 coordination ve 13 güvenli application tool'u ile sunar.
Codex project config'i exact tool allowlist ve `writes` approval modunu; Claude project/local config'i
aynı server komutunu kullanır. Dashboard discovery → handoff create → CLI consume → replay reject zinciri
canlı PostgreSQL/HTTP kabulünde kapanmıştır. Localhost Streamable HTTP MCP ve MCP'siz CLI adapter'ı ileri iştir.

## Session → onay ve execute

Model/MCP tool'u onay veremez. Kullanıcı session içinde öneri özetini gördükten sonra
yerel companion komutunu bizzat çalıştırır:

```text
reklamzeka review <action-unit-id>
reklamzeka approve <action-unit-id>
reklamzeka execute <action-unit-id>
```

Komutlar önce before/after, post preview, PromotionTemplate/AudiencePreset, bütçe etkisi,
risk ve dependency'leri gösterir; TTY/passkey confirmation ister. `approve` ile `execute`
ayrıdır. Agent'ın shell çalıştırması tek başına yeterli değildir; OS human-presence
doğrulaması olmadan grant üretilmez.

## Şablonla agentic anlaşılabilirlik

`PromotionTemplate` hem yapılandırılmış alanlar hem kullanıcı alias/description/examples
taşır. Örneğin “TR saç ekimi remarketing post boost” ifadesi exact template ID, account/
Instagram scope, internal category selector ve immutable audience preset version'a resolve
edilir. Agent yalnız candidate'ları açıklayıp seçer; targeting JSON oluşturmaz.

Template eşleşmesi sırası:

`explicit template ID/alias > locked internal category binding > account+actor+post rule > agent suggestion`

İlk üç kat deterministiktir. Agent suggestion tek aday ve eşik üstü confidence olsa bile
proposal preview'da kaynak olarak görünür; birden fazla adayda kullanıcı seçimi zorunludur.

## Güvenlik değişmezleri

- loopback/STDIO varsayılan; LAN/public bind explicit kurulum ve auth olmadan yok;
- session token workspace/role/tool scope/expiry ve OS user'a bağlı;
- Meta token ve provider login/session dosyaları MCP response/log'a girmez;
- arbitrary CLI command, raw Graph, raw SQL, approval grant mint tool'u yok;
- L0 raw payload/dump yok; context bütçesi ve typed drill-down sınırı tüm client'larda aynı;
- dashboard/CLI aynı approval-only ve action valve sonucunu alır.

K4 policy görünürlüğü server-private `policy_bundle_read` adapter'ı üzerinden sağlanır.
Adapter yeni bir public HTTP route açmaz; CLI/MCP broker'ın süreli local capability'sini ve
her çağrıda yeniden okunan workspace üyeliğini kullanır. Agent aynı ApprovalPolicy,
Guardrail, katalog ve readiness projeksiyonunu görür, ancak dashboard draft yetkisini
devralamaz ve policy mutasyonu yapamaz.

### İlk yerel dashboard session bağlaması

İlk üretim read-model bağlaması tek kullanıcı makinesinde açıkça etkinleştirilen, sabit
bir yerel principal ve süreli capability kullanır. `workspaceId`, public `workspaceRef`,
`actor userId` ve `readerRef` yalnız server environment'tan gelir; query, body, cookie
claim'i veya agent argümanı bu kimlikleri seçemez. HMAC-imzalı capability aynı değerleri,
salt-okunur tool scope'unu, `issuedAt`/`expiresAt`, session/nonce ve server process OS UID
bağını taşır; doğrulanan claim'ler server binding ile exact eşleşmelidir. Üyelik rolü
environment'ta tutulmaz: her istekte aktif workspace ve güncel `memberships` kaydı
PostgreSQL'den yeniden doğrulanır. Üyelik silinirse veya workspace tombstone sürecine
girerse erişim process restart beklemeden kapanır.

HTTP yüzeyi yalnız yapılandırılan exact loopback origin/Host çiftini kabul eder. Güvenli
dashboard cookie'si için düz HTTP yalnız `http://localhost` ile desteklenir; `127.0.0.1`
ve `[::1]` loopback adresleri HTTPS ister. `Forwarded`,
`X-Forwarded-*` ve benzeri başlıklar locality kanıtı sayılmaz. Next.js'in doğrudan loopback
isteğe eklediği tam ve origin ile birebir eşleşen canonical dört başlık yalnız framework uyumluluğu
için kabul edilir; kısmi, çoklu, harici IP veya host/protokol/port uyuşmazlığı fail-closed reddedilir. Bu nedenle ilk
sürüm reverse proxy, LAN bind veya public deployment arkasında çalıştırılmaz. GET için
cross-site Fetch Metadata reddedilir. Tek mutation olan idempotent inbox `mark_read`, exact
same-origin `Origin`, `Sec-Fetch-Site: same-origin`, JSON ve `X-ReklamZeka-Intent` ister.
Dashboard session cookie'si yalnız 90 saniyelik, OS-user bağlı ve dosya sisteminde
tek-kullanımlık nonce kaydı bulunan bootstrap capability tüketilince server tarafından
yeniden mint edilir; gelen session ID cookie'ye taşınmaz (fixation yoktur). Cookie
`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` ve sekiz saat ömürlüdür. CLI aynı
doğrulayıcıya doğrudan süreli Bearer capability sunabilir. Bearer tekrar oynatma riski
expiry/tool scope ile sınırlandırılır; mevcut tek state mutation idempotent `mark_read`
olduğu için replay yeni yetki veya timestamp üretmez. DB URL, signing key ve diğer sırlar
yalnız server process'indedir; response ve uygulama log'una yazılmaz.
Bir session; üyeliği kaldırarak anında veri erişiminden düşürülebilir, tüm mevcut
capability'leri kriptografik olarak iptal etmek için signing key rotate edilip local process
yeniden başlatılır.

Dashboard capability üretimi proje kökünde `npm run local-session:mint` ile yapılır; bu
komut `.env.local` dosyasını açıkça yükler. Script doğrudan `tsx
scripts/mint-local-session.ts` şeklinde çağrılırsa environment otomatik yüklenmez ve aynı
değişkenlerin çağıran shell tarafından verilmesi gerekir. CLI capability için
`npm run local-session:mint -- --cli` kullanılır. Capability terminal/history açısından
geçici kimlik bilgisi sayılır; paylaşılmaz ve log'a yönlendirilmez.

Session bir konuşmadan GuidanceCard veya AdvisedPractice taslağı çıkarabilir. Bunlar
dashboard Practice Lab'de versioned review/outcome görmeden standardize, publish veya
enforceable policy olamaz; conversation memory kalıcı öğrenme kaynağı değildir.
