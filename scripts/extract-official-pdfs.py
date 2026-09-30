"""Достаёт картинки карт из PDF издателя в apps/web/assets/official/*.jpg.

Запуск из корня репозитория (PDF лежат в Загрузках):
    python -m pip install pymupdf
    python scripts/extract-official-pdfs.py "C:/Users/<имя>/Downloads"

Затем пересоберите пакет картинок и стол:
    python scripts/pack-table-images.py
    npm run table

Соответствие страниц картам:
  Карты предприятий.pdf      стр. N        -> co-ib-(N-1)   (тот же номер скана, что в interbellum-companies.mjs)
  Стартовые предприятия.pdf  стр. 1..9     -> st-off-1..9
  Карты университетов.pdf    стр. 1..6     -> uni-1..6
  жетоны управляющих.pdf     стр. 1..15    -> mgr-01..15
  Персонажи.pdf              стр. 1..8     -> char-01..08
Файлы PDF защищены авторским правом издателя: в репозиторий их публиковать нельзя.
"""
import os
import sys

try:
    import pymupdf
except ImportError:
    sys.exit("Нужен PyMuPDF: python -m pip install pymupdf")

SETS = [
    ("Карты предприятий.pdf", "co-ib-{:02d}", 0),
    ("Стартовые предприятия.pdf", "st-off-{}", 1),
    ("Карты университетов.pdf", "uni-{}", 1),
    ("жетоны управляющих.pdf", "mgr-{:02d}", 1),
    ("Персонажи.pdf", "char-{:02d}", 1),
]
WIDTH = 1000          # достаточно для стола; дальше пакет сожмёт до 700
OUT = os.path.join("apps", "web", "assets", "official")


def main(folder):
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for pdf, pattern, first in SETS:
        path = os.path.join(folder, pdf)
        if not os.path.exists(path):
            sys.exit(f"Нет файла {path}")
        doc = pymupdf.open(path)
        for index, page in enumerate(doc):
            zoom = WIDTH / page.rect.width
            pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
            name = pattern.format(index + first) + ".jpg"
            pix.save(os.path.join(OUT, name), jpg_quality=88)
            total += 1
        print(f"{pdf}: {doc.page_count} стр.")
    print(f"Готово: {total} файлов -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Downloads"))
