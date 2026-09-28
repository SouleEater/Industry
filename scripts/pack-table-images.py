"""Упаковка изображений карт в один JS-модуль для сборки цифрового стола.

Исходники: apps/web/assets/user-base/*.jpg (те же файлы, что показывает каталог).
Результат: apps/table/card-images.js — сгенерированный файл, который читает
scripts/build-table.mjs. Пересоздавать нужно только после замены макетов.

Требуется Pillow. Запуск из корня репозитория:
    python scripts/pack-table-images.py
"""
import base64
import hashlib
import json
import os
import sys

SRC = os.path.join("apps", "web", "assets", "user-base")
OUT = os.path.join("apps", "table", "card-images.js")
WIDTH = 700      # хватает и для стола, и для просмотра карты крупно
QUALITY = 76

try:
    from PIL import Image
except ImportError:
    sys.exit("Нужен Pillow: python -m pip install Pillow")


def main() -> None:
    if not os.path.isdir(SRC):
        sys.exit(f"Не найдена папка {SRC}. Запускайте из корня репозитория.")

    files = sorted(f for f in os.listdir(SRC) if f.lower().endswith(".jpg"))
    if not files:
        sys.exit(f"В {SRC} нет изображений.")

    images, manifest, total = {}, {}, 0
    for name in files:
        path = os.path.join(SRC, name)
        with Image.open(path) as im:
            im = im.convert("RGB")
            height = round(im.height * WIDTH / im.width)
            im = im.resize((WIDTH, height), Image.LANCZOS)
            buffer = __import__("io").BytesIO()
            im.save(buffer, "WEBP", quality=QUALITY, method=6)
        data = buffer.getvalue()
        key = os.path.splitext(name)[0]
        images[key] = base64.b64encode(data).decode("ascii")
        manifest[key] = {
            "source": name,
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        }
        total += len(data)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as handle:
        handle.write("// СГЕНЕРИРОВАНО scripts/pack-table-images.py. Руками не править.\n")
        handle.write(f"// {len(images)} изображений, ширина {WIDTH}px, WEBP q{QUALITY}.\n")
        handle.write("const CARD_IMAGES = " + json.dumps(images) + ";\n")

    with open(os.path.join("apps", "table", "card-images.manifest.json"), "w", encoding="utf-8") as handle:
        json.dump({"width": WIDTH, "quality": QUALITY, "images": manifest}, handle, ensure_ascii=False, indent=1)

    print(f"{len(images)} изображений, {total / 1048576:.2f} МБ webp "
          f"({total * 4 / 3 / 1048576:.2f} МБ в base64) → {OUT}")


if __name__ == "__main__":
    main()
