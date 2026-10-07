"""Keep the original core independently buildable for matched benchmarks."""
from pathlib import Path
import argparse
import os
import sys
import tempfile
from setuptools import Distribution, Extension
from setuptools.command.build_ext import build_ext

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--lto', action='store_true', help='Enable release link-time optimization for matched Rust benchmarks')
args = parser.parse_args()
lto = ['-flto=thin' if sys.platform == 'darwin' else '-flto'] if args.lto else []
os.chdir(ROOT)
sources = ["cpp/bindings.cpp", "cpp/engine.cpp", "cpp/fast_eval.cpp", "cpp/vendor/ompeval/HandEvaluator.cpp"]
ext = Extension("poker_engine._cpp_reference", sources, language="c++",
                define_macros=[("POKER_CPP_REFERENCE", "1")],
                extra_compile_args=["-O3", "-std=c++17", "-pthread", *lto], extra_link_args=["-pthread", *lto])
with tempfile.TemporaryDirectory(prefix="poker-cpp-") as temp:
    command = build_ext(Distribution({"ext_modules": [ext]}))
    command.ensure_finalized()
    command.build_temp = temp
    command.inplace = True
    command.force = True  # Compiler flags are not part of setuptools' timestamp check.
    command.run()
print("C++ reference built; Rust remains the production backend.")
