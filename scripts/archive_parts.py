"""Store/reconstruct the original ZIP in Git-sized parts using only Python stdlib."""
from pathlib import Path
import argparse
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'research/archives'
ARCHIVE = FOLDER / 'base-industry.zip'
MANIFEST = FOLDER / 'base-industry.parts.json'
PART_BYTES = 45_000_000

def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        while data := source.read(1024 * 1024):
            digest.update(data)
    return digest.hexdigest()

def split():
    records = []
    with ARCHIVE.open('rb') as source:
        while data := source.read(PART_BYTES):
            name = f'base-industry.zip.part{len(records) + 1:03d}'
            (FOLDER / name).write_bytes(data)
            records.append({'file': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    MANIFEST.write_text(json.dumps({'archive': ARCHIVE.name, 'bytes': ARCHIVE.stat().st_size,
                                    'sha256': checksum(ARCHIVE), 'parts': records}, indent=2), encoding='utf-8')
    print(f'Stored {len(records)} parts; original ZIP unchanged.')

def restore():
    spec = json.loads(MANIFEST.read_text(encoding='utf-8'))
    if ARCHIVE.exists():
        if checksum(ARCHIVE) != spec['sha256']:
            raise ValueError('An existing ZIP differs; it will not be overwritten.')
        print('Original ZIP already present; SHA-256 verified.')
        return
    parts = []
    for item in spec['parts']:
        name = item['file']
        if Path(name).name != name or '/' in name or '\\' in name:
            raise ValueError('Invalid part filename')
        path = FOLDER / name
        if path.stat().st_size != item['bytes'] or checksum(path) != item['sha256']:
            raise ValueError(f'Corrupted part: {name}')
        parts.append(path)
    temporary = FOLDER / 'base-industry.zip.assembling'
    digest = hashlib.sha256()
    with temporary.open('wb') as output:
        for path in parts:
            with path.open('rb') as source:
                while data := source.read(1024 * 1024):
                    output.write(data)
                    digest.update(data)
    if temporary.stat().st_size != spec['bytes'] or digest.hexdigest() != spec['sha256']:
        raise ValueError('Reconstructed ZIP checksum mismatch')
    temporary.replace(ARCHIVE)
    print('Original ZIP restored and SHA-256 verified.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--split', action='store_true', help='Create Git-sized parts from the existing original ZIP')
    args = parser.parse_args()
    split() if args.split else restore()
