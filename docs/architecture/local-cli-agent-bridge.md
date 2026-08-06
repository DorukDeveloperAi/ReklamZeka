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
3. Açık session `get_handoff_context` ile aynı seçimi alır.
4. Agent analiz/promotion template seçeneklerini okur ve proposal üretir.
5. Proposal dashboard inbox'ta aynı correlation ID ile görünür.

Handoff veri snapshot'ı değil, scoped referans ve version setidir. Session her aracı
çağırdığında tenant/role/stale kontrolü yeniden yapılır.

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
- dashboard/CLI aynı approval-only ve action valve sonucunu alır.
