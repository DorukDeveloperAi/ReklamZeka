# P06-A — Effective Guide overlap resolver

- `deliveryRef`: P06-A-effective-guide-overlap-20260817
- Durum: saf domain alt görevi ana sürücü tarafından kabul edildi; P06 persistence/executor zinciri açık.
- Input: tek workspace/entity/market üzerindeki exact canonical aktif Guide revisionları ile bounded compiled restriction/cap evidence.
- Resolution: action allowlist intersection; `limited_autonomy → prepare_human_approval → recommend → observe_analyze` yönünde en kısıtlayıcı mode; deny/manual-lock/protection union; action+cap türü başına en düşük limit.
- Safety: rename her durumda human-only; farklı anlamla tekrar kullanılan restriction/cap ref ve unresolved conflict hold; cross-market/cross-workspace/duplicate active guide/forged revision fail-closed.
- Determinism: host-independent ordering; effective Guide set, restriction set ve final resolution SHA-256 hash'leri input orderından bağımsız.
- Authority/network: `canApprove=false`, `canExecute=false`, `canWriteMeta=false`, `canGrantAutonomy=false`; DB/schema/UI/Meta transport yok.
- Test: Guide + overlap testleri 15/15; typecheck, DB check, security boundaries ve diff check PASS.
- Rollback: iki saf domain/test dosyasını geri almak yeterlidir; veri veya migration rollback yoktur.
- Kabul: ana sürücü, 2026-08-17.
