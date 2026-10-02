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

SRCS = [os.path.join("apps", "web", "assets", "user-base"), os.path.join("apps", "web", "assets", "official")]
OUT = os.path.join("apps", "table", "card-images.js")
CROP = (38, 55, 879, 1175)   # рамка карты внутри макета 900x1300: убираем белые поля
WIDTH = 640      # хватает и для стола, и для просмотра карты крупно
QUALITY = 72

try:
    import numpy as np
    from PIL import Image
except ImportError:
    sys.exit("Нужны Pillow и numpy: python -m pip install Pillow numpy")


ART_WIDTH = 520
ART_QUALITY = 70
# Карты, которые стол рисует сам: иллюстрация вырезается отдельно, а строки эффектов
# рисуются по данным. Сканы остаются в каталоге как оригиналы.
DRAWN = ("009-", "024-", "128-", "117-", "co-ib-", "st-off-", "uni-")
# Портреты промышленников: левая часть карточки (справа у издателя набран текст).
PORTRAIT_BOX = {"char-": (0.0, 0.0, 0.53, 1.0), "116-": (0.02, 0.2, 0.47, 0.99)}
PORTRAIT_WIDTH = 380
# У университетов под полосой компенсации лежит рисунок с книгами.
UNI_ART = (0.31, 0.93)
# У официальных страниц иллюстрация лежит между полосой ресурсов и орнаментом.
OFFICIAL_ART = (0.105, 0.495)


def art_rows(im):
    """Для макетов 900x1300 ищем самую длинную серию строк не цвета бумаги."""
    a = np.asarray(im).astype(int)
    h, w, _ = a.shape
    c = a[:, int(w * .08):int(w * .92)]
    mx, mn = c.max(axis=2), c.min(axis=2)
    paper = ((mx > 205) & ((mx - mn) < 38)).mean(axis=1)
    art = paper < 0.45
    best, i = (0, 0), 0
    while i < h:
        if art[i]:
            j = i
            while j < h and (art[j] or (j + 1 < h and art[j + 1]) or (j + 2 < h and art[j + 2])):
                j += 1
            if j - i > best[1] - best[0]:
                best = (i, j)
            i = j
        else:
            i += 1
    return best


def cut_art(im, mockup, name=""):
    """Иллюстрация без рамки и текста, чуть уже краёв карты."""
    w, h = im.size
    if mockup:
        top, bottom = art_rows(im)
    elif name.startswith("uni-"):
        top, bottom = round(h * UNI_ART[0]), round(h * UNI_ART[1])
    else:
        top, bottom = round(h * OFFICIAL_ART[0]), round(h * OFFICIAL_ART[1])
    art = im.crop((round(w * 0.015), top + 2, round(w * 0.985), bottom - 2))
    return art.resize((ART_WIDTH, round(art.height * ART_WIDTH / art.width)), Image.LANCZOS)


# Полные сканы карт раньше шли в пакет целиком (~5 МБ). Карты, университеты, жетоны и
# промышленники теперь рисуются по данным, поэтому сканы включаются только по флагу.
WITH_SCANS = "--with-scans" in sys.argv


def main() -> None:
    files = [(d, f) for d in SRCS if os.path.isdir(d) for f in sorted(os.listdir(d)) if f.lower().endswith(".jpg")]
    if not files:
        sys.exit("Нет изображений в " + ", ".join(SRCS) + ". Запускайте из корня репозитория.")

    images, manifest, sizes, total = {}, {}, {}, 0
    for folder, name in files:
        path = os.path.join(folder, name)
        with Image.open(path) as im:
            im = im.convert("RGB")
            mockup = im.size == (900, 1300)
            if mockup:
                im = im.crop(CROP)
            if name.startswith(DRAWN):
                art = cut_art(im, mockup, name)
                abuf = __import__("io").BytesIO()
                art.save(abuf, "WEBP", quality=ART_QUALITY, method=4)
                akey = "art-" + os.path.splitext(name)[0]
                images[akey] = base64.b64encode(abuf.getvalue()).decode("ascii")
                sizes[akey] = list(art.size)
                total += len(abuf.getvalue())
            for prefix, box in PORTRAIT_BOX.items():
                if name.startswith(prefix):
                    w0, h0 = im.size
                    crop = im.crop((round(w0 * box[0]), round(h0 * box[1]), round(w0 * box[2]), round(h0 * box[3])))
                    crop = crop.resize((PORTRAIT_WIDTH, round(crop.height * PORTRAIT_WIDTH / crop.width)), Image.LANCZOS)
                    pbuf = __import__("io").BytesIO()
                    crop.save(pbuf, "WEBP", quality=ART_QUALITY, method=4)
                    pkey = "port-" + os.path.splitext(name)[0]
                    images[pkey] = base64.b64encode(pbuf.getvalue()).decode("ascii")
                    sizes[pkey] = list(crop.size)
                    total += len(pbuf.getvalue())
            if not WITH_SCANS:
                continue   # стол рисует карты сам: полный скан нужен только с флагом --with-scans
            height = round(im.height * WIDTH / im.width)
            im = im.resize((WIDTH, height), Image.LANCZOS)
            buffer = __import__("io").BytesIO()
            im.save(buffer, "WEBP", quality=QUALITY, method=4)
        data = buffer.getvalue()
        key = os.path.splitext(name)[0]
        images[key] = base64.b64encode(data).decode("ascii")
        sizes[key] = [WIDTH, height]
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
        handle.write("const CARD_SIZES = " + json.dumps(sizes) + ";\n")

    with open(os.path.join("apps", "table", "card-images.manifest.json"), "w", encoding="utf-8") as handle:
        json.dump({"width": WIDTH, "quality": QUALITY, "images": manifest}, handle, ensure_ascii=False, indent=1)

    print(f"{len(images)} изображений, {total / 1048576:.2f} МБ webp "
          f"({total * 4 / 3 / 1048576:.2f} МБ в base64) -> {OUT}")


if __name__ == "__main__":
    main()
