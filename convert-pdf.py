"""Conservative PDF conversion: ordered text layer + page raster fallback.

No OCR/model calls. Original embedded images come from the existing package.
The original PDF and full rendered pages remain available for layout fidelity.
"""
import hashlib
import json
from pathlib import Path
import re
import shutil

import pdfplumber
import pypdfium2

CACHE = Path('D:/AppData/ReadwiseReaderArchive')
ROOT = Path('D:/Projects/渐进阅读工作流/imports/readwise-validation')

def convert(source):
    previous = ROOT / source.stem
    package = ROOT / (source.stem + '-pdf-ordered')
    package.mkdir(exist_ok=True)
    assets = package / 'assets'
    assets.mkdir(exist_ok=True)
    manifest = json.loads((previous / 'manifest.json').read_text(encoding='utf-8'))
    original_copy = package / manifest['source']['copy_path']
    original_copy.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, original_copy)
    for asset in manifest['assets']:
        shutil.copy2(previous / asset['package_path'], package / asset['package_path'])
    pdf = pypdfium2.PdfDocument(source)
    blocks, pages, extra_assets = [], [], []
    cached_text_path = package / 'page-text.json'
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    cached = json.loads(cached_text_path.read_text(encoding='utf-8')) if cached_text_path.exists() else {}
    cached_text = cached.get('pages') if cached.get('source_sha256') == source_hash else None
    extracted_text = []
    with pdfplumber.open(source) as document:
        for index, page in enumerate(document.pages):
            number = index + 1
            text = cached_text[index] if cached_text is not None else page.extract_text(x_tolerance=3, y_tolerance=3) or ''
            extracted_text.append(text)
            blocks.append(f'<a id="pdf-page-{number}"></a>\n<!-- pdf-page:{number} -->\n\n')
            # Escape Markdown control characters without rewriting source text.
            if text.strip():
                blocks.append(re.sub(r'([\\`*_{}\[\]<>#!|])', r'\\\1', text) + '\n\n')
                for asset in manifest['assets']:
                    if re.search(fr'page-0*{number}-image-', asset['package_path']):
                        blocks.append(f"![原页插图]({asset['package_path']})\n\n")
            else:
                target = assets / f'page-{number:04d}-full.png'
                pdf[index].render(scale=1.5).to_pil().save(target)
                extra_assets.append({'package_path': str(target.relative_to(package)).replace('\\', '/'),
                    'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
                blocks.append(f'![PDF 原页 {number}](assets/{target.name})\n\n')
            pages.append({'page': number, 'text_chars': len(text), 'mode': 'text_layer' if text.strip() else 'full_page_image'})
    body = ''.join(blocks)
    cached_text_path.write_text(json.dumps({'source_sha256': source_hash, 'pages': extracted_text}, ensure_ascii=False), encoding='utf-8')
    # Markdown escaping preserves the literal PDF text.
    (package / 'raw.md').write_text(body, encoding='utf-8')
    manifest.update({'status': 'completed', 'extractor': {'name': 'reader-archive.pdf-text-layer/1'},
        'assets': manifest['assets'] + extra_assets})
    (package / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    quality = {'status': 'completed', 'quality': {'page_count': len(pages), 'pages_preserved': len(pages),
        'text_pages': sum(p['mode'] == 'text_layer' for p in pages), 'image_only_pages': sum(p['mode'] == 'full_page_image' for p in pages),
        'character_count': sum(p['text_chars'] for p in pages)}, 'warnings': [], 'pages': pages}
    (package / 'quality.json').write_text(json.dumps(quality, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'id': source.stem, **quality['quality']}, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    for source in (CACHE / 'originals').glob('*.pdf'):
        convert(source)
