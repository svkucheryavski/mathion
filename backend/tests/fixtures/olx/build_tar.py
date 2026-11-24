"""Build frontend/src/tests/fixtures/olx-course.tar.gz from the fixture course, byte for byte reproducibly."""
import gzip
import io
import os
import tarfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "course"
TARGET = HERE.parents[2].parent / "frontend" / "src" / "tests" / "fixtures" / "olx-course.tar.gz"


def members() -> list[Path]:
    found = [SOURCE]
    for dirpath, dirnames, filenames in os.walk(SOURCE):
        dirnames[:] = [d for d in dirnames if d != "__pycache__"]
        found += [Path(dirpath) / n for n in dirnames + filenames if n != ".DS_Store"]
    return sorted(found, key=lambda p: p.relative_to(HERE).as_posix())


def build() -> bytes:
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for path in members():
            info = tarfile.TarInfo(path.relative_to(HERE).as_posix())
            info.mtime, info.uid, info.gid, info.uname, info.gname = 0, 0, 0, "", ""
            if path.is_dir():
                info.type, info.mode = tarfile.DIRTYPE, 0o755
                tar.addfile(info)
            else:
                data = path.read_bytes()
                info.size, info.mode = len(data), 0o644
                tar.addfile(info, io.BytesIO(data))
    out = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=out, mtime=0, compresslevel=9) as gz:
        gz.write(raw.getvalue())
    return out.getvalue()


if __name__ == "__main__":
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_bytes(build())
    print(TARGET, TARGET.stat().st_size)
