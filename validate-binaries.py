"""Offline validation of original Reader EPUB/PDF files; never calls a model."""
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.request

CACHE = Path('D:/AppData/ReadwiseReaderArchive')
WORKFLOW = Path('D:/Projects/渐进阅读工作流')
ARTIFACTS = Path('D:/Artifacts/ReadwiseReaderArchive')

def main():
    documents = json.loads((CACHE / 'binary-source-index.json').read_text(encoding='utf-8-sig'))
    originals = CACHE / 'originals'
    originals.mkdir(exist_ok=True)
    results = []
    for doc in documents:
        result = {'id': doc['id'], 'category': doc['category']}
        source = originals / (doc['id'] + '.' + doc['category'])
        output = WORKFLOW / 'imports' / 'readwise-validation' / doc['id']
        try:
            if not source.exists():
                if not doc.get('raw_source_url'):
                    result['status'] = 'source_unavailable'
                    results.append(result)
                    print(f"{doc['category']} {doc['id']}: source_unavailable", flush=True)
                    continue
                with urllib.request.urlopen(doc['raw_source_url'], timeout=60) as response:
                    payload = response.read()
                signature = b'%PDF-' if doc['category'] == 'pdf' else b'PK'
                if not payload.startswith(signature):
                    raise ValueError('source signature mismatch')
                source.write_bytes(payload)
            if not (output / 'manifest.json').exists():
                env = dict(os.environ, PYTHONPATH=str(WORKFLOW / 'rich-text-import' / 'src'))
                process = subprocess.run([sys.executable, '-m', 'rich_text_import', str(source),
                    '--output', str(output), '--json'], env=env, capture_output=True, text=True,
                    encoding='utf-8', timeout=240)
                if process.returncode:
                    result['status'] = 'extractor_failed'
                    # The local extractor receives only local paths, no credentials.
                    result['error'] = process.stderr[-2000:]
                else:
                    result['extraction'] = json.loads(process.stdout)
                    result['status'] = 'extracted'
            else:
                result['status'] = 'cached'
            result['source_bytes'] = source.stat().st_size
            result['package'] = str(output)
        except Exception as error:
            result['status'] = 'failed'
            result['error_type'] = type(error).__name__
        results.append(result)
        ARTIFACTS.mkdir(parents=True, exist_ok=True)
        (ARTIFACTS / 'binary-validation.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f"{doc['category']} {doc['id']}: {result['status']}", flush=True)
    (ARTIFACTS / 'binary-validation.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')

if __name__ == '__main__':
    main()
