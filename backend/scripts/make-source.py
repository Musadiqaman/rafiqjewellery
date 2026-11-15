from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root=Path(__file__).resolve().parents[2]
files=[]
for folder in ['frontend','backend']:
 for path in (root/folder).rglob('*'):
  if not path.is_file():continue
  relative=path.relative_to(root)
  if any(part in ['node_modules','dist','downloads','.data','__pycache__'] for part in relative.parts):continue
  if path.name.startswith('.env') and path.name!='.env.example':continue
  if path.suffix in ['.zip','.gz','.pyc','.log']:continue
  files.append(path)
output=root/'frontend/public/downloads/rafiq-ledger-source.zip'
output.parent.mkdir(parents=True,exist_ok=True)
with ZipFile(output,'w',ZIP_DEFLATED) as archive:
 for path in sorted(files):archive.write(path,'rafiq-ledger/'+str(path.relative_to(root)))
print(f'Created {output}: {len(files)} files, frontend/ and backend/ only.')
