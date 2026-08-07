# ADR-0011 — Model-agnostic yerel AI CLI ve MCP

## Durum

Kabul — 2026-08-06; provider API adapter kararı önceki revizyondan kaldırıldı

## Bağlam

Kullanıcı dashboardla aynı reklam operasyonlarını açık Codex CLI/VS Code, Claude Code
veya istediği başka AI CLI session'ından yapmak; bilgisayarı açıkken bu ürünlerin kendi
login/session'ını kullanmak ve ReklamZeka'da model API anahtarı/API çağrısı tutmamak istiyor.

## Karar

- Core domain motorları model SDK/API'si import etmez ve agentsız tam çalışır.
- Ortak yüzey localhost Streamable HTTP veya project STDIO ReklamZeka MCP server'dır.
- Codex CLI/VS Code, Claude Code ve ek MCP istemcileri aynı read ve draft/proposal
  tools'a tenant-scoped bağlanır; kendi login/subscription state'lerini kendileri yönetir.
- Dashboard chat için OpenAI/Anthropic provider adapter'ı mevcut kapsamda yapılmaz;
  dashboard bir local-session hub, context handoff ve proposal/action kontrol yüzeyidir.
- MCP'siz CLI yalnız allowlist `LocalCliAdapter` dedicated subprocess ile eklenebilir;
  mevcut TTY hijack veya arbitrary shell yoktur.
- Agent approval/execute yetkisi alamaz. Session içinden insan işlemi, dashboard veya
  local companion TTY/passkey `HumanPresenceGrant`ı ile atomik action unit bazındadır.
- Session memory convenience'tır; published category/policy/template/budget/schedule/
  approval state'i ReklamZeka veritabanından resolve edilir.

## Sonuçlar

Provider API maliyeti/anahtar yönetimi olmadan kullanıcı tercih ettiği yerel agent
oturumuyla çalışır; dashboard ve session aynı proposal/timeline'ı paylaşır. Bilgisayar veya
yerel servis kapalıyken bridge çalışmaz. MCP/session health, handoff, companion approval ve
client config UI maliyeti kabul edilir.
