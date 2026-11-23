import argparse
import json
import re
from pathlib import Path

import pymupdf

BAD = re.compile(r'\b(?:undefined|NaN|null)\b|\[object')
AGREEMENT = 'ข้อตกลง'
SIGNERS = ('ลูกค้ายืนยันรายละเอียด', 'แอดมินผู้ทำใบ', 'ผู้ควบคุมงาน')

def inspect(path):
    with pymupdf.open(path) as document:
        texts = [page.get_text() for page in document]
        pages = [''.join(text.split()) for text in texts]
        agreement = [i + 1 for i, page in enumerate(pages) if AGREEMENT in page]
        all_signers = [
            i + 1 for i, page in enumerate(pages)
            if all(signer in page for signer in SIGNERS)
        ]
        return {
            'pages': len(pages),
            'bad': BAD.findall('\n'.join(texts)),
            'agreement_pages': agreement,
            'signer_pages': all_signers,
            'together': bool(set(agreement) & set(all_signers)),
        }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('results', type=Path)
    parser.add_argument('previous', type=Path)
    args = parser.parse_args()
    audit = {}
    for mode in ('minimum', 'full'):
        current = args.results / mode
        old = args.previous if mode == 'minimum' else args.previous / mode
        audit[mode] = {}
        for path in sorted(current.glob('*.pdf')):
            if path.stem.startswith('r14-ag-all-'):
                continue
            result = inspect(path)
            prior = old / (('r15-cx-min-' if mode == 'minimum' else '') + path.name)
            result['previous_pages'] = inspect(prior)['pages'] if prior.exists() else None
            audit[mode][path.stem] = result
    out = args.results / 'pdf-audit.json'
    out.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf8')
    for mode, products in audit.items():
        print(mode, 'PDF', len(products), 'raw tokens', sum(bool(x['bad']) for x in products.values()),
              'signatures together', sum(x['together'] for x in products.values()),
              'previous matched', sum(x['previous_pages'] is not None for x in products.values()))

if __name__ == '__main__':
    main()
