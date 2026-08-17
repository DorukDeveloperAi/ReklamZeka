# ReklamZeka v3 — Durum Defteri

| Paket | Durum | Dependency |
|---|---|---|
| M00 | AÇIK | — |
| P01 meta-veri-sagligi | BEKLİYOR | M00 |
| P02 kurum-kampanyasi-kunye | BEKLİYOR | P01 |
| P03 slice-operasyon-rapor | BEKLİYOR | P02 |
| P04 kilavuz-butce | BEKLİYOR | P03 |
| P05 agent-analiz-kosum | BEKLİYOR | P04 |
| P06 karar-otonomi-uygulama | BEKLİYOR | P05 |
| P07 ui-ux | BEKLİYOR (paralel) | M00; P01–P06 ile birleşir |
| P08 kabul-rollout | BEKLİYOR (cross gate) | M00,P01–P07 |

`PASS` yalnız ilgili R3 evidence-pack, functional/browser test ve P08 gate kanıtıyla yazılır.
