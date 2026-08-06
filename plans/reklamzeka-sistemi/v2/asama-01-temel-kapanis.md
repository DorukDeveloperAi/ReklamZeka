---
kosum: tek-ajan
getirir:
  - dugum: arac:.claude/kanit.json
  - dugum: arac:scripts/githooks/pre-commit
  - dugum: arac:.github/workflows/ci.yml
  - dokunur: modul:pyproject.toml
---
# Aşama 01 — TEMEL KAPANIŞ (v2)

> Roadmap: [MASTER.md](MASTER.md) · Bağımlı: —
> Bu dosya KENDİ BAŞINA yeterlidir: taze bir /goal session'ı yalnız bunu okuyarak işi bitirebilmeli.

## Bağlam (bu aşamayı koşan session için)

Proje kökü: `/Users/ybg/dev/ReklamZeka` (git repo, branch `main`; origin
`github.com/DorukDeveloperAi/ReklamZeka` tanımlı ama **bu aşamada push YOK**).
v1 Faz 0 kod ayağı bitti (bkz. `plans/reklamzeka-sistemi/v1/MASTER.md` + `v1/STATE.md`);
bu aşama o temeli KALICI düzene bağlar: geçici Python 3.9 venv'i yerine uv/3.12,
kanıt-defteri (`.claude/kanit.json`) ve her commit'te zorunlu lint kapısı.
**Yeni özellik kodu YAZILMAZ** — yalnız araç zinciri + kayıt.

**Ölçülmüş durum (2026-08-06):**
- `.venv/bin/python --version` → `Python 3.9.6` (sistem Python'u; geçici düzen — proje hedefi 3.12).
- `.venv/bin/python -m pytest -q` → **`14 passed, 2 skipped in 0.03s`** (toplam 16 toplanır).
  2 skip = `tests/test_mcp_contract.py` canlı MCP testleri: `META_MCP_ACCESS_TOKEN` + `mcp`
  paketi yok (Faz 0 KULLANICI adımı — bu aşamanın kapsamı DIŞI, skip normaldir).
- `python scripts/lint_terminology.py` → `terminoloji lint: temiz` · exit 0.
  Lint kapsamı `SCAN_DIRS = src, scripts, tests, config` (docs/ ve plans/ kapsam dışı);
  muafiyet: satıra `term-ok`. Lint zaten pytest'in İÇİNDE: `tests/test_terminology_lint.py::
  test_repo_is_clean` gerçek repoyu lint'ler → `pytest` koşumu lint'i kapsar.
- `which uv` → **yok**. `brew` var (`/opt/homebrew/bin/brew`); uv kurulum onayı 2026-08-06'da verildi.
- `git status`: `src/ tests/ config/ docs/ plans/ scripts/ README.md pyproject.toml .gitignore`
  **untracked**; `utopya/` altında başka iş akışının değişiklikleri var — **DOKUNMA, stage'leme**.
- `.gitignore` zaten `.venv/`, `warehouse.db`, `__pycache__/` içeriyor; `uv.lock`'u İÇERMİYOR (doğru — kilit dosyası commit'lenecek).
- `pyproject.toml`: `requires-python = ">=3.12"`, `pytest` şu an `[project.optional-dependencies].dev`'de; extras: `mcp`, `sheets`, `panel`.
- Commit mesaj biçimi: `.claude/aide/docs/commit-sozlesmesi.md` (kapsam zorunlu · NEDEN + `Kanıt:` satırı).
- `.claude/kanit.json` HENÜZ YOK; biçim emsali `~/dev/dorukcom06/.claude/kanit.json`
  (İNSAN yazar; `cmd` argv DİZİSİ, `sh -c` yok; `bilinenKirmizi ⇒ sebep+takip`). Sonraki
  aşamaların REQUIREMENTS tabloları buradaki girişlere `kanit:hizli` biçiminde referans verecek.

## SONUÇ

**Bu aşama bitince:** uv ile Python 3.12 ortamında mevcut 14 test yeşil koşuyor
(`uv run pytest -q` → `14 passed, 2 skipped`), kilit dosyası (`uv.lock`) repoda;
`.claude/kanit.json` üç girişle (hizli · tam · surus) kurulu ve `hizli` fiilen koşuluyor;
terminoloji lint'i pre-commit kapısı (yerel, versiyonlu hook) + CI tanımı
(`.github/workflows/ci.yml`) olarak her commit'te zorunlu; iskelet dosyaları git'e
commit'li ve o commit kapıdan geçmiş durumda.

## Önkoşullar

- `brew` kurulu (ölçüldü: var) · uv kurulum onayı verildi (2026-08-06) — insan adımı YOK.
- Ağ erişimi (brew + uv'nin CPython 3.12 ve paket indirmeleri).
- `utopya/` değişikliklerine ve v1 canlı-MCP kullanıcı adımlarına (OAuth/token) dokunulmaz.

## Task'lar

### T01.1 — uv geçişi (Python 3.12 + kilit dosyası)
**SONUÇ:** Ortam uv-yönetimli Python 3.12; `uv.lock` + `.python-version` üretilmiş; testler yeşil.
**Subtask'lar:**
1. `brew install uv` → `uv --version` çalışıyor.
2. Repo kökünde `uv python pin 3.12` → `.python-version` dosyası oluşur (commit'e girecek).
3. `pyproject.toml`: `pytest>=8.0`'ı `[project.optional-dependencies].dev`'den ÇIKAR,
   PEP 735 `[dependency-groups]` altına `dev = ["pytest>=8.0"]` olarak taşı (`uv sync`
   dev grubunu varsayılan kurar; çifte tanım bırakma). `mcp`/`sheets`/`panel` extras AYNEN kalır.
4. `rm -rf .venv` (3.9.6 geçici düzeni) → `uv sync` → yeni `.venv` (3.12) + `uv.lock` oluşur.
5. `uv run pytest -q` ve `uv run python scripts/lint_terminology.py` yeşil.
6. `README.md` Kurulum bölümünü uv'ye çevir: `uv sync` · `uv run pytest` ·
   `uv run python scripts/lint_terminology.py` · extras için `uv sync --extra mcp` vb.
**Kabul kriteri (kanıt):** `uv run python -c "import sys; print(sys.version_info[:2])"` → `(3, 12)`
ve `uv run pytest -q` → çıktı satırında `14 passed, 2 skipped`.

### T01.2 — Kanıt defteri: `.claude/kanit.json` (hizli · tam · surus)
**SONUÇ:** Üç girişli kanıt-defteri kurulu; sonraki aşamalar `kanit:hizli` / `kanit:tam` / `kanit:surus` referansı verebiliyor.
**Subtask'lar:** `.claude/kanit.json`'u AŞAĞIDAKİ içerikle yaz (İNSAN-yazar sözleşme; `cmd` argv dizisi, `sh -c` YOK):
```json
{
  "$sema": "ReklamZeka kanıt sözleşmesi (v2 aşama-01). İNSAN yazar, araçlar YALNIZ okur. sinif: hizli (her kanıt-regresyonunda; ~saniyeler) · tam (tam kabul; hizli'yi KAPSAR) · surus (canlı koşu denetimi — koşulmaz, artefakt tazeliği ölçülür). cmd argv DİZİSİ (sh -c yok). bilinenKirmizi ⇒ sebep+takip ZORUNLU (sessiz muafiyet değil, İLAN).",
  "girisler": [
    {
      "ad": "hizli",
      "sinif": "hizli",
      "cmd": ["uv", "run", "pytest", "-q"],
      "timeoutSn": 60,
      "not": "Lint + birim testleri: terminoloji lint'i tests/test_terminology_lint.py::test_repo_is_clean içinde gerçek repoya karşı koşar, ayrı komut gerekmez. Ölçüldü 2026-08-06: 14 passed, 2 skipped, <1sn. 2 skip = canlı MCP sözleşme testleri (META_MCP_ACCESS_TOKEN + mcp paketi yok — Faz 0 kullanıcı adımı, İLANLI sınır; skip FAIL değildir)."
    },
    {
      "ad": "tam",
      "sinif": "tam",
      "cmd": ["uv", "run", "--extra", "mcp", "pytest", "-q"],
      "timeoutSn": 300,
      "not": "Tam kabul: mcp extra kurulur; META_MCP_ACCESS_TOKEN ortamda VARSA canlı MCP sözleşme testleri de koşar (skip kalkar). Token yokken hizli ile aynı sonucu verir — bu bilinen ve İLANLI durumdur, bilinenKirmizi DEĞİLDİR (kırmızı yok, eksik kullanıcı adımı var: plans/reklamzeka-sistemi/v1/STATE.md)."
    },
    {
      "ad": "surus",
      "sinif": "surus",
      "artefakt": "docs/mcp-envanter.md",
      "tazelikSaat": 720,
      "not": "Canlı koşu denetimi. Bugün artefakt BOŞ ŞABLON (Faz 0 canlı doğrulaması bekliyor) → ÖLÇÜLEMEDİ sayılır, ürün FAIL'i değil. Canlı doğrulamayı yapan aşama artefaktı doldurur ve gerekirse artefakt yolunu/tazeliği kendi kadansına göre günceller (720 sa başlangıç değeridir, ölçümden değil)."
    }
  ]
}
```
**Kabul kriteri (kanıt):** `python3 -m json.tool .claude/kanit.json > /dev/null && echo json-ok` → `json-ok`;
ardından `hizli` girişinin komutu aynen: `uv run pytest -q` → exit 0, `14 passed, 2 skipped`.

### T01.3 — Pre-commit kapısı (versiyonlu hook + `core.hooksPath`) ve kırmızı-kanıt
**SONUÇ:** Her commit'te `kanit:hizli` sınıfı zorunlu koşuyor ve kapının kırmızı YANABİLDİĞİ kanıtlı.
**Subtask'lar:**
1. `scripts/githooks/pre-commit` dosyasını yaz (uzantısız → lint tarama kapsamına girmez) ve `chmod +x`:
   ```sh
   #!/bin/sh
   # ReklamZeka pre-commit kapısı — kanit:hizli sınıfı (terminoloji lint + pytest).
   # Kurulum (bir kez, klon başına): git config core.hooksPath scripts/githooks
   set -e
   if ! command -v uv >/dev/null 2>&1; then
     echo "pre-commit: uv bulunamadı — 'brew install uv' (sessiz geçiş YASAK)" >&2
     exit 1
   fi
   cd "$(git rev-parse --show-toplevel)"
   uv run python scripts/lint_terminology.py
   uv run pytest -q
   ```
2. `git config core.hooksPath scripts/githooks` (yerel ayar, versiyonlanmaz) + README Kurulum'a
   tek satır: klonlayan herkes bu komutu bir kez koşar. Ayar unutulursa CI (T01.4) aynı kapıyı koşar —
   `pre-commit` framework'ü (ayrı pip aracı) bilinçli ELENDİ: sıfır-bağımlılık hooksPath yeterli.
3. **Kırmızı-kanıt provası** (kapı gerçekten engelliyor mu — elle "kuruldu" demek kanıt değildir):
   `printf 'x = "%s"\n' "camp""aign" > src/_lint_probe.py` (çıplak terim bu dosyada da parçalı
   tutulur — `tests/test_terminology_lint.py:15` deseni) → `git add src/_lint_probe.py` →
   `git commit -m "probe"` → **BEKLENEN: commit DÜŞER** (exit ≠ 0, çıktıda `TERMINOLOJI IHLALI`).
   Temizlik: `git reset -- src/_lint_probe.py && rm src/_lint_probe.py`.
**Kabul kriteri (kanıt):** prova commit'i exit ≠ 0 + `TERMINOLOJI IHLALI` çıktısı (kırmızı yanıyor);
temizlik sonrası `uv run pytest -q` → `14 passed, 2 skipped` (iz kalmadı).

### T01.4 — CI tanımı: `.github/workflows/ci.yml`
**SONUÇ:** CI'da her push/PR'da kilit doğrulaması + lint + test koşacak tanım repoda duruyor (push bu aşamada YOK).
**Subtask'lar:** dosyayı şu içerikle yaz (`astral-sh/setup-uv` sürümünü yazım anında güncel major ile teyit et):
```yaml
name: ci
on: [push, pull_request]
jobs:
  kanit-hizli:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5   # .python-version'ı okur
      - run: uv sync --locked          # kilit bayatsa FAIL — uv.lock sözleşmesi CI'da ölçülür
      - run: uv run python scripts/lint_terminology.py
      - run: uv run pytest -q
```
**Kabul kriteri (kanıt):** `uv run python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml-ok')"` → `yaml-ok`
ve `grep -c lint_terminology .github/workflows/ci.yml` → `1`.
İLANLI SINIR: workflow'un GERÇEK koşumu remote'a push ister — bu aşamada ölçülemez; yerel eşdeğeri T01.3 kapısı + `kanit:hizli`.

### T01.5 — Repo kaydı: iskeleti commit'le (kapı ilk gerçek commit'te çalışır)
**SONUÇ:** İskelet + bu aşamanın ürünleri git'te; commit pre-commit kapısından geçmiş (kapının yeşil kanıtı).
**Subtask'lar:**
1. `utopya/` STAGE'LENMEZ (başka iş akışının değişiklikleri — kapsam dışı).
2. `git add .gitignore README.md pyproject.toml uv.lock .python-version config docs plans scripts src tests .github .claude/kanit.json`
3. Tek commit (`iskelet tek mantıksal birim` — parçalamak bilgi getirmiyor), mesaj
   `.claude/aide/docs/commit-sozlesmesi.md` biçiminde; kapsam `kok`, gövdede NEDEN (Faz 0 temel
   kapanışı: uv/3.12 + kanıt-defteri + commit kapısı) + `Kanıt: uv run pytest -q → 14 passed, 2 skipped`.
4. Commit'in başarması = pre-commit kapısının pozitif kanıtı (T01.3 negatifin, bu pozitifin kanıtı).
5. `plans/reklamzeka-sistemi/v1/STATE.md` "Bloklar" listesindeki "Python 3.12 kurulumu"
   maddesini kapat (uv ile çözüldü notu + tarih).
**Kabul kriteri (kanıt):** `git status --short | grep -v utopya` → boş çıktı
ve `git log -1 --format='%s'` → `kok: ...` konulu iskelet commit'i.

## Task checklist
- [ ] T01.1 — uv geçişi · kanıt: `uv run pytest -q` → `14 passed, 2 skipped` (Python 3.12)
- [ ] T01.2 — kanıt defteri · kanıt: `python3 -m json.tool .claude/kanit.json` → geçerli; hizli cmd exit 0
- [ ] T01.3 — pre-commit kapısı · kanıt: probe commit DÜŞTÜ (`TERMINOLOJI IHLALI`), temizlik sonrası yeşil
- [ ] T01.4 — CI tanımı · kanıt: `yaml-ok` + `grep -c lint_terminology .github/workflows/ci.yml` → `1`
- [ ] T01.5 — repo kaydı · kanıt: `git status --short | grep -v utopya` → boş; son commit kapıdan geçti

## Aşama requirements
| id | requirement | doğrulama | delege |
|---|---|---|---|
| R-01.1 | Testler uv/Python 3.12 altında yeşil (14 passed, 2 skipped) ve `uv.lock` repoda | `kanit:hizli` (bu aşamada kurulur) | pre-commit + CI |
| R-01.2 | Terminoloji lint'i her commit'te zorunlu kapı ve kırmızı YANABİLİYOR | `kanit:hizli` + T01.3 kırmızı-kanıt provası | `scripts/githooks/pre-commit` |
| R-01.3 | Kanıt-defteri üç girişle (hizli·tam·surus) geçerli ve `hizli` koşulabilir | `python3 -m json.tool .claude/kanit.json` + hizli cmd exit 0 | — |
| R-01.4 | CI tanımı repoda ve `kanit:hizli` ile eşdeğer adımları taşıyor | yeni — sınıf: hizli (yaml parse + grep; gerçek koşum İLANLI sınır: push yok) | `.github/workflows/ci.yml` |

## Doğrulama (aşama kapanışı)
Sırayla, repo kökünde (`/Users/ybg/dev/ReklamZeka`):
```sh
uv run python -c "import sys; print(sys.version_info[:2])"     # → (3, 12)
uv run python scripts/lint_terminology.py                      # → "terminoloji lint: temiz" · exit 0
uv run pytest -q                                               # → 14 passed, 2 skipped
python3 -m json.tool .claude/kanit.json > /dev/null && echo ok # → ok
git config core.hooksPath                                      # → scripts/githooks
test -x scripts/githooks/pre-commit && echo hook-ok            # → hook-ok
git status --short | grep -v utopya                            # → boş çıktı (iskelet commit'li)
```
İdempotens: tüm komutlar tekrar koşulabilir; `uv sync` ikinci koşumda değişiklik yapmaz;
T01.5 ikinci koşumda "nothing to commit" der — bu hata DEĞİLDİR. T01.3 provası her
koşumda kendi izini siler (probe dosyası commit'e asla girmez).

## Efor/maliyet notu
Küçük hacim: tek oturum (~1 saat), çoğu adım deterministik komut (token maliyeti düşük).
Ağ indirmesi: brew uv + uv-yönetimli CPython 3.12 + paketler (~100-200 MB, bir kez).

## Bitirirken (zorunlu)
1. `CHECKLIST.md`'de bu aşamanın maddelerini işaretle.
2. `STATE.md`'ye tur kaydı yaz: tarih · yapılan · kanıt yolları · açık kalan.
