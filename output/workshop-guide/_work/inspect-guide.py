import json
import zipfile
from pathlib import Path
from pdf2image import convert_from_path
from pypdf import PdfReader

work = Path(__file__).resolve().parent
pdf = work / 'AIxRay_Process_Workshop_Guide.pdf'
out = work / 'render'
out.mkdir(exist_ok=True)
reader = PdfReader(str(pdf))
pages = []
for i, page in enumerate(reader.pages, 1):
    text = page.extract_text() or ''
    pages.append({'page': i, 'characters': len(text), 'first_lines': text.splitlines()[:5]})
for i, image in enumerate(convert_from_path(str(pdf), dpi=120, poppler_path='C:/Users/JOOTEY/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin'), 1):
    image.save(out / f'page-{i:02d}.png')
docx = work.parent / 'AIxRay_Process_Workshop_Guide.docx'
with zipfile.ZipFile(docx) as archive:
    images = [n for n in archive.namelist() if n.startswith('word/media/') and n.endswith('.png')]
result = {'pages': len(pages), 'embedded_screenshots': len(images), 'page_summary': pages}
(work / 'document-verification.json').write_text(json.dumps(result, indent=2), encoding='utf8')
print(json.dumps(result, indent=2))
