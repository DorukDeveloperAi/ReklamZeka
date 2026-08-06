#!/usr/bin/env python3
"""Terminoloji lint'i — MASTER §1: çıplak terim yasağı (bkz. docs/terminoloji.md).

Kural: her kullanım nitelenmiş olmalı — internal_campaign*, meta_campaign*,
"Meta Campaign", "İç Kampanya", IC_KAMPANYA*. Harici (Meta'nın kendi araç/alan
adları gibi) kaçınılmaz kullanımlar satıra `term-ok` yorumu ile muaf tutulur.

Kapsam: src/ scripts/ tests/ config/ (docs/ prose'u Meta dokümanlarından alıntı
içerebileceği için kapsam dışıdır).

Çıkış kodu: ihlal varsa 1.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SCAN_DIRS = ("src", "scripts", "tests", "config")
SCAN_SUFFIXES = {".py", ".yaml", ".yml", ".toml", ".json", ".sh", ".md"}

ALLOWED = re.compile(
    r"(internal_campaign[a-z_]*"
    r"|meta_campaign[a-z_]*"
    r"|Meta Campaign[s]?"
    r"|IC_KAMPANYA[A-ZİĞÜŞÖÇ_]*"
    r"|[İi]ç [Kk]ampanya\w*)"
)
BARE = re.compile(r"(?i)(campaign|kampanya)")  # term-ok: yasaklı kalıbın tanımı
WAIVER = "term-ok"


def lint_file(path: Path) -> list[tuple[int, str]]:
    violations: list[tuple[int, str]] = []
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return violations
    for lineno, line in enumerate(text.splitlines(), start=1):
        if WAIVER in line:
            continue
        stripped = ALLOWED.sub("", line)
        if BARE.search(stripped):
            violations.append((lineno, line.strip()))
    return violations


def main(root: Path) -> int:
    all_violations: list[str] = []
    for dirname in SCAN_DIRS:
        base = root / dirname
        if not base.exists():
            continue
        for path in sorted(base.rglob("*")):
            if path.suffix not in SCAN_SUFFIXES or not path.is_file():
                continue
            for lineno, line in lint_file(path):
                all_violations.append(f"{path.relative_to(root)}:{lineno}: {line}")
    if all_violations:
        print("TERMINOLOJI IHLALI — çıplak terim kullanımı:")
        for v in all_violations:
            print(f"  {v}")
        print(f"\n{len(all_violations)} ihlal. Nitelenmiş ad kullan "
              "(internal_campaign* | meta_campaign* | 'İç Kampanya' | 'Meta Campaign') "
              "ya da kaçınılmaz harici ad için satıra `term-ok` ekle.")
        return 1
    print("terminoloji lint: temiz")
    return 0


if __name__ == "__main__":
    root_arg = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
    sys.exit(main(root_arg))
