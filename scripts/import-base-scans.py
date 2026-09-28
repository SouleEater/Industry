"""Safely inventory the user-supplied ZIP. No contained document is executed."""
from pathlib import Path
import zipfile, hashlib, json, shutil, argparse
from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, help='Optional original ZIP to copy when the repository archive is absent')
args = parser.parse_args()
DEST = ROOT / 'research/imported/base'
DEST.mkdir(parents=True, exist_ok=True)
archive = ROOT / 'research/archives/base-industry.zip'
archive.parent.mkdir(parents=True, exist_ok=True)
if not archive.exists():
    if args.source is None:
        from archive_parts import restore
        restore()
    else:
        shutil.copyfile(args.source, archive)
records = []
with zipfile.ZipFile(archive) as z:
    assert sum(i.file_size for i in z.infolist()) < 700_000_000
    for i, entry in enumerate(z.infolist()):
        if entry.is_dir():
            continue
        name = entry.filename
        if not entry.flag_bits & 0x800:
            try:
                name = name.encode('cp437').decode('cp866')
            except (UnicodeError, ValueError):
                pass
        suffix = Path(name).suffix.lower()
        if suffix not in ['.png','.jpg','.jpeg','.pdf','.pptx']:
            continue
        target = DEST / f'{i:03d}{suffix}'
        data = z.read(entry)
        target.write_bytes(data)
        row = {'entry': i, 'originalPath': name, 'path': target.relative_to(ROOT).as_posix(), 'bytes': len(data), 'sha256':hashlib.sha256(data).hexdigest()}
        if suffix in ['.png','.jpg','.jpeg']:
            with Image.open(target) as im:
                row['size'] = list(im.size)
        records.append(row)
manifest = {'archive':'research/archives/base-industry.zip','archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'records':records}
(ROOT/'research/base-import-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
images = [r for r in records if 'size' in r]
for start in range(0,len(images),20):
    page = Image.new('RGB',(1400,1250),'#eee9dc')
    draw = ImageDraw.Draw(page)
    for j,r in enumerate(images[start:start+20]):
        im=Image.open(ROOT/r['path']).convert('RGB')
        im.thumbnail((268,275))
        x,y=(j%5)*280,(j//5)*310
        page.paste(im,(x+(280-im.width)//2,y+25))
        draw.text((x+8,y+5),f"{r['entry']:03d}  {r['size'][0]}x{r['size'][1]}",fill='black')
    page.save(DEST/f'contact-{start//20+1}.jpg')
print(json.dumps({'files':len(records),'images':len(images),'groups':sorted(set(r['originalPath'].split('/')[1] for r in records))},ensure_ascii=False))
for r in records:
    print(f"{r['entry']:03d} {r['originalPath']}")
