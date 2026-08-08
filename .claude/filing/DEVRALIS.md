# DEVRALIŞ — ReklamZeka

> **TÜREVDİR, elle düzenlenmez.** Her `aide filing` koşumunda yeniden üretilir.
> Kaynak: canlı oturum kayıtları + plan ağacı + kilitler. Üretim: 2026-08-08 07:55

Bu belge bir sonraki Claude hesabının **ilk okuyacağı** dosyadır: neyin yarıda kaldığını
ve hangi komutla devam edileceğini söyler.

## Açık oturumlar

1 canlı oturum. Devam etmek için komutu kopyala-yapıştır:

### commit and push

- **durum:** `done` · son hareket: 2026-08-08 07:06
- **ne için açıldı:** codex tarafından ciddi ilerleme kaydedilmişti ama commmit ve push yapıldı mı emin değilim en son durumu
- **nerede kaldı:** commit and push

```bash
cd /Users/ybg/dev/ReklamZeka && claude --resume 9a339aed-a0cc-4fd9-9711-7e8e4e5529ff
```

## Planlar

| plan | durum | sıradaki aşama |
|---|---|---|
| `proje` 2 | SÜRÜYOR | — |
| `reklamzeka-sistemi` 2 | AÇIK | 01-temel-kapanis |

Sıradaki işi başlatmak için:

```bash
cd /Users/ybg/dev/ReklamZeka
/goal plans/reklamzeka-sistemi/v2/asama-01-temel-kapanis.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz
```

## Devralma sırası

```bash
# 1. bu profili donat (ön koşul varsaymaz)
~/dev/agent-ide/bin/aide-kurulum

# 2. denetle
aide kurulum doctor && aide filing durum

# 3. yukarıdaki oturum komutlarından birini seç
```

**Taşınmayan:** sohbet geçmişinin kendisi (hesaba özel). Yukarıdaki özetler o geçmişten
çıkarıldı; `--resume` komutları YALNIZ aynı makinede/aynı hesapta çalışır. Başka makinede
özetler bağlam verir, oturumlar yeniden açılır.
