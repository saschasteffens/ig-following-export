"""Build the installable zip without npm dependencies or network requests."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parent.parent
version = json.loads((root / "extension/manifest.json").read_text())["version"]
output = root / "dist" / f"following-export-{version}.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
    for file in sorted((root / "extension").iterdir()):
        if file.is_file():
            archive.write(file, "following-export/" + file.name)
    archive.write(root / "GETTING_STARTED.html", "GETTING_STARTED.html")
    archive.write(root / "README.md", "README.md")
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert "following-export/manifest.json" in archive.namelist()
print(f"Created {output}")
