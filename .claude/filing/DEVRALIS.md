# DEVRALIŞ — ReklamZeka

> **TÜREVDİR, elle düzenlenmez.** Her `aide filing` koşumunda yeniden üretilir.
> Kaynak: canlı oturum kayıtları + plan ağacı + kilitler. Üretim: 2026-08-19 19:09

Bu belge bir sonraki Claude hesabının **ilk okuyacağı** dosyadır: neyin yarıda kaldığını
ve hangi komutla devam edileceğini söyler.

## Açık oturumlar

1 canlı oturum. Devam etmek için komutu kopyala-yapıştır:

### bu tarz bir mcp sunucu kullanmak mı daha mantıklı yoksa bunu zaetn ai…

- **durum:** `done` · son hareket: 2026-08-19 16:23
- **ne için açıldı:** bu tarz bir mcp sunucu kullanmak mı daha mantıklı yoksa bunu zaetn ai .ile kodlamak kolay mı ne sunuyor bu bize https://pipeboard.co/guides/claude-code
- **nerede kaldı:** bu tarz bir mcp sunucu kullanmak mı daha mantıklı yoksa bunu zaetn ai .ile kodlamak kolay mı ne sunuyor bu bize https://pipeboard.co/guides/claude-code

```bash
cd /Users/ybg/dev/ReklamZeka && claude --resume 0a8377bc-e59b-4b05-8397-716b893f1420
```

## Kapanmış oturumların devir notları

Session-düzeyi kapanış fotoğrafları (`plans/oturumlar/devir/`) — canlı listede
GÖRÜNMEYEN ama niyeti/açık hedefi kayıtlı oturumlar. Açık hedefli olanlar devralınmayı
bekliyor olabilir (sıralı liste: `~/.claude/oturum/KILAVUZ.md`):

- **`ot:2026-08-10/commit-and-push`** · kapanış 2026-08-10 06:06 (other) · hedef 5/5 kapalı
- **`ot:2026-08-06/reklamzeka-faz-0-kurulum`** · kapanış 2026-08-06 12:39 (other) · hedef 17/17 kapalı
  - niyet: Onaylı planın Faz 0'ı ayakta: repo iskeleti, terminoloji lint'i, şemalar, taksonomi çözücü, rubrik varsayılanl

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
