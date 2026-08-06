# <ROADMAP ADI> — REQUIREMENTS (v<N>)

> Her requirement ölçülebilir bir yüklemdir ve doğrulama yolu yanında yazar.
> Mümkünse mevcut bir kapıya DELEGE edilir; yeni ölçüt ancak "bu soruyu yanıtlayan
> kaynak yok" ise yazılır.
>
> **Doğrulama sütunu kanıta bağlanır (`kanit:<giriş-adı>`):** doğrulama mümkünse projenin
> `.claude/kanit.json` tablosundaki bir girişe işaret eder (`kanit:hizli-test`, `kanit:tam` gibi;
> hakem `aide rota kanit` ile bunu koşar). Böyle bir giriş YOKSA hücre "yeni — sınıf: hizli|tam|surus"
> yazar ve o girişi `.claude/kanit.json`'a eklemek planın bir TASK'ı olur. Çıplak serbest-metin
> doğrulama ("testler geçer", "elle bakılır") YASAK — ölçülemeyen requirement kanıtsızdır.

## Global

| id | requirement (yüklem) | doğrulama (kanit:<giriş> / yeni-sınıf) | delege |
|---|---|---|---|
| R-G1 | <…> | `kanit:<giriş-adı>` ya da "yeni — sınıf: tam" | <mevcut kapı ya da "yeni"> |

## Aşama-bazlı

### Aşama 01 — <ad>
| id | requirement | doğrulama | delege |
|---|---|---|---|
| R-01.1 | <…> | <…> | <…> |
