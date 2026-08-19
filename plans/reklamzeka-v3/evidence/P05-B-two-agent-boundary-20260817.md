# P05-B — İki Agent rol sınırı saf domain

- `deliveryRef`: P05-B-two-agent-boundary-20260817
- Durum: alt domain teslimi kabul edildi; transcript persistence/runtime henüz açık olduğu için P05 paketi tamamlanmadı.
- Agentlar: `guide_policy` ve `daily_analysis` ayrı deterministic conversation ref taşır; geçmişleri birleşmez.
- Kılavuz Agentı: read-only context, ephemeral revision suggestion ve yalnız explicit user transfer ref ile form preview. Save/activate yok.
- Günlük Agent: member analysis, slice synthesis ve server-owned run ledger finding kaydı; öneri yalnız uygun mode + ready data; candidate yalnız human-approval/limited-autonomy mode + ready data.
- Her iki Agent diğerinin operasyon loglarını salt-okunur görebilir.
- Authority: Guide save/activate, approval, execution ve Meta write her iki Agent için daima false/denied.
- Persistence sınırı: Kılavuz önerisi persistence `none`; Günlük sonuç yalnız ileride bağlanacak `server_run_ledger`, doğrudan DB aracı değil.
- Test: 3 P05 dosya / 16 test; typecheck ve diff-check PASS.
- Migration/network/Meta write: yok / 0 / 0.
