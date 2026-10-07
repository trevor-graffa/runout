"""Regenerate the portable Omaha asset locally, with no network or external datasets."""
import gzip
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="poker-tables-") as temp:
    executable = Path(temp) / "generate"
    raw = Path(temp) / "omaha.bin"
    subprocess.run([os.environ.get("CXX", "c++"), "-std=c++17", "-O3", "-pthread", "-Icpp",
                    "tools/generate_tables.cpp", "cpp/engine.cpp", "cpp/fast_eval.cpp",
                    "cpp/vendor/ompeval/HandEvaluator.cpp", "-o", str(executable)],
                   cwd=ROOT, check=True)
    subprocess.run([str(executable), str(raw)], check=True)
    data = raw.read_bytes()
    target = ROOT / "poker_engine/data/omaha.bin.gz"
    target.write_bytes(gzip.compress(data, compresslevel=9, mtime=0))
    print(f"Wrote {target}; uncompressed SHA256: {hashlib.sha256(data).hexdigest()}")
