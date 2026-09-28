"""Copy PowerPoint-rendered card faces into the web catalogue. Requires Pillow."""
from pathlib import Path
from PIL import Image
import hashlib, json

ROOT = Path(__file__).resolve().parents[1]
dest = ROOT / 'apps/web/assets/user-base'
dest.mkdir(parents=True, exist_ok=True)
records = []
for entry, first, last in [(9, 1, 18), (24, 1, 24), (116, 1, 5), (117, 1, 5), (128, 2, 21)]:
    folder = ROOT / f'research/imported/base/slides-{entry:03d}'
    slides = {int(''.join(filter(str.isdigit, p.stem))): p for p in folder.glob('*.PNG')}
    for slide in range(first, last + 1):
        source = slides[slide]
        target = dest / f'{entry:03d}-{slide:02d}.jpg'
        with Image.open(source) as im:
            im.convert('RGB').save(target, quality=92, optimize=True)
        records.append({'archiveEntry': entry, 'slide': slide,
                        'path': target.relative_to(ROOT).as_posix(),
                        'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
(ROOT/'research/base-web-assets.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
print(f'Exported {len(records)} card faces; source files unchanged.')
