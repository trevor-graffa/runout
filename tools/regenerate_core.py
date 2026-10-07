"""Reproduce the portable numeric core tables from the preserved C++ sources."""
import gzip
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="poker-core-") as temp:
    executable = Path(temp)/'export'; raw = Path(temp)/'core.bin'
    subprocess.run([os.environ.get('CXX','c++'),'-std=c++17','-O3','-pthread','-Icpp',
        'tools/export_cpp_tables.cpp','cpp/engine.cpp','cpp/vendor/ompeval/HandEvaluator.cpp',
        '-o',str(executable)],cwd=ROOT,check=True)
    subprocess.run([str(executable),str(raw)],check=True)
    data=raw.read_bytes(); target=ROOT/'data/core.bin.gz'
    target.write_bytes(gzip.compress(data,compresslevel=9,mtime=0))
    print(f'Wrote {target}; uncompressed SHA256: {hashlib.sha256(data).hexdigest()}')
