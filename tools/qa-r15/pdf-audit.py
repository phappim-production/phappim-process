import argparse
import json
import re
from pathlib import Path

import pymupdf

parser = argparse.ArgumentParser()
parser.add_argument('files', nargs='+', type=Path)
args = parser.parse_args()
result = []
for file in args.files:
    with pymupdf.open(file) as pdf:
        pages = [page.get_text() for page in pdf]
        outside = []
        for page in pdf:
            for word in page.get_text('words'):
                if not (pymupdf.Rect(word[:4]) in page.rect):
                    outside.append([page.number + 1, word[4]])
        result.append({
            'file': file.name,
            'pages': len(pdf),
            'sizes': [[round(page.rect.width), round(page.rect.height)] for page in pdf],
            'fonts': sorted({font[3] for page in pdf for font in page.get_fonts()}),
            'bad': sorted(set(re.findall(r'undefined|NaN|\[object|\bnull\b', '\n'.join(pages)))),
            'empty_pages': [i + 1 for i, text in enumerate(pages) if not text.strip()],
            'terms_pages': [i + 1 for i, text in enumerate(pages) if 'ข้อตกลง' in text],
            'signature_pages': [i + 1 for i, text in enumerate(pages) if 'ลูกค้ายืนยันรายละเอียด' in text or 'ผู้อนุมัติ' in text or 'ลงชื่อ' in text],
            'outside': outside,
        })
print(json.dumps(result, ensure_ascii=False, indent=2))
