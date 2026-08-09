# DEVRALIŞ — ReklamZeka

> **TÜREVDİR, elle düzenlenmez.** Her `aide filing` koşumunda yeniden üretilir.
> Kaynak: canlı oturum kayıtları + plan ağacı + kilitler. Üretim: 2026-08-09 21:17

Bu belge bir sonraki Claude hesabının **ilk okuyacağı** dosyadır: neyin yarıda kaldığını
ve hangi komutla devam edileceğini söyler.

## Açık oturumlar

_Bu projede canlı oturum yok._

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
