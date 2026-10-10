# ReklamZeka

@.claude/aide/docs/aide-capabilities.md

## aide altyapısı

Bu proje `aide` tarafından yönetiliyor. Yetenek envanteri (`aide sync` ile tazelenir):

> **Kit sınırı:** Bu proje AIDE kitinin yalnız tüketicisidir. `/Users/ybg/dev/agent-ide`
> dışındaki hiçbir AIDE kit kaynağı veya kit projeksiyonu burada değiştirilmez; kit/sync
> sapmaları bu projede düzeltme işi değildir. Kalıcı kit değişikliği yalnız `agent-ide`
> projesinde yapılır. `utopya/` ise ReklamZeka'ya ait yerel proje içeriğidir; şablondan
> farkı beklenir ve sync uyarısı olarak ele alınmaz.

@.claude/docs/model-policy.md
@utopya/KUZEY.md
@utopya/KURALLAR.md
@utopya/vizyon/OKU.md
@utopya/istek/hedefler.md
@utopya/istek/yetenekler.md
@utopya/istek/nitelikler.md
@utopya/istek/ilkeler.md
@utopya/istek/alt-projeler.md
@.claude/aide/docs/terimler.md

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN SHARED PROJECT COORDINATION v1 -->
## Ortak proje yönetimi

Codex–Claude ortak tahta: `ortak/TAHTA.md`. Proje yönetimi ve devir için `project-coordination` becerisini kullan; bulunamazsa bu tahtanın mevcut protokolüyle devam et. İkinci backlog veya otomasyon kurma; mevcut proje kuralları ve yetkiler korunur.
<!-- END SHARED PROJECT COORDINATION v1 -->

<!-- BEGIN AGENT ROUTING 2026-10-07 -->
## Mevcut agenttan devam et

Göreve başlarken [ortak proje tahtasını](</Users/ybg/dev/ReklamZeka/ortak/TAHTA.md>) ve [agent yönlendirme kuralını](</Users/ybg/Library/Mobile Documents/com~apple~CloudDocs/Projeler/Proje Merkezi/sistem/AGENT-KOORDINASYONU.md>) oku. Yeni analizden önce mevcut sonuç ve görev sahibini bul; gerekiyorsa kullanıcının yetkili kapsamında mevcut chate hedefli iş ilet. Sahipliği ve kanıtı aynı tahtaya yaz; merkez dizini için `python3 "/Users/ybg/Library/Mobile Documents/com~apple~CloudDocs/Projeler/Proje Merkezi/sistem/agentlar.py"` çalıştır. Projeye özgü koordinatör/claim kuralları korunur.
<!-- END AGENT ROUTING 2026-10-07 -->

<!-- BEGIN PROJECT GUIDE SET 2026-10-10 -->
[Proje kılavuz seti](</Users/ybg/Library/Mobile Documents/com~apple~CloudDocs/Projeler/Proje Merkezi/sistem/PROJE-KILAVUZ-SETI.md>) — yeni iş/devirde kısa giriş, proje mantığı ve ayrıntı kaynakları. [Bu projenin kaynak haritası](</Users/ybg/dev/ReklamZeka/ortak/TAHTA.md>). Mevcut proje yetki ve kör görev istisnaları korunur.
<!-- END PROJECT GUIDE SET 2026-10-10 -->
