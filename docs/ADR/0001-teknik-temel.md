# ADR-0001 — Teknik temel

- Durum: kabul edildi
- Tarih: 2026-08-06

## Bağlam

ReklamZeka; çok kiracılı web deneyimi, reklam API'lerinden arka plan veri toplama,
ilişkisel analitik model, açıklanabilir kural motoru ve tarayıcı tabanlı pilot akışları
gerektiriyor. İlk ekip küçük olacağı için web ve API sözleşmelerinin tek TypeScript
ekosisteminde kalması; veri ve worker sınırlarının ise ayrı modüllere ayrılabilmesi gerekiyor.

## Karar

- Runtime: Node.js 22 LTS tabanı, ESM ve strict TypeScript.
- Web/API: Next.js 16 App Router; server components ve route handlers.
- Veritabanı: PostgreSQL; şema ve sürümlü SQL migration için Drizzle ORM/Kit.
- Arka plan işleri: İlk connector aşamasında PostgreSQL tabanlı kalıcı iş kuyruğu; ayrı worker süreci. Redis ancak ölçülen ihtiyaç doğarsa eklenir.
- Test: Vitest sözleşme/birim/entegrasyon, sonraki aşamada Playwright E2E.
- Dağıtım: Standalone Node.js/Docker uyumlu çıktı; sağlayıcıya özgü edge bağımlılığı yok.

## Gerekçe

Next.js App Router güncel resmi kurulumun varsayılanıdır ve Node 20.9+ ister; mevcut Node 22
tabanı uygundur. PostgreSQL kiracı, bağlantı, audit ve idempotency değişmezlerini transaction
ve unique constraint'lerle korur. Drizzle şemayı TypeScript'te tutup sürümlü SQL migration
üretir. Tek dil ilk ürün hızını artırırken `src/db` ve ilerideki worker sınırı veri katmanını
UI'dan ayırır.

## Alternatifler

- Ayrı NestJS API: erken aşamada iki deployment ve çift sözleşme maliyeti; connector hacmi web sürecinden ayrılmayı zorunlu kıldığında yeniden değerlendirilir.
- Prisma: güçlü araç seti, fakat SQL ve migration çıktısı üzerinde daha doğrudan kontrol için Drizzle seçildi.
- Supabase/Firebase'a tam bağımlılık: başlangıcı hızlandırır fakat auth/veri/iş kuyruğunu sağlayıcıya bağlar; standart PostgreSQL taşınabilirliği tercih edildi.
- Redis kuyruğu: ek operasyonel bağımlılık; ilk hacimde PostgreSQL yeterli, ölçüm aksini gösterirse ADR revize edilir.

## Sonuçlar

- Tüm tenant-bearing tablolarda açık `workspace_id` veya üyelik bağı olmalıdır.
- Uygulama salt-okunur connector scope ilkesini API adapter testlerinde zorlamalıdır.
- Migration dosyaları kod incelemesine girer; production'da `push` kullanılmaz.
- Next.js'e özgü kod `src/app` sınırında, veri sözleşmeleri framework bağımsız modüllerde tutulur.
- Drizzle Kit 0.31.x'in yerel geliştirme ağacında eski esbuild kaynaklı orta seviye bir
  development-server bildirimi vardır. Araç yalnız migration üretiminde localhost/CI içinde
  çalıştırılır ve dış ağa açılmaz; production bağımlılık taraması temiz kalmak zorundadır.
  Drizzle'ın kararlı ve düzeltilmiş sürümü çıktığında bildirim kaldırılmadan yükseltme tamamlanmış sayılmaz.
