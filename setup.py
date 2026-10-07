import sys
from setuptools import Extension, setup

setup(ext_modules=[Extension(
    "poker_engine._native",
    sources=["cpp/bindings.cpp", "cpp/engine.cpp", "cpp/fast_eval.cpp", "cpp/vendor/ompeval/HandEvaluator.cpp"],
    depends=["cpp/engine.hpp", "cpp/fast_eval.hpp", "cpp/vendor/ompeval/HandEvaluator.h",
             "cpp/vendor/ompeval/Hand.h", "cpp/vendor/ompeval/Util.h", "cpp/vendor/ompeval/OffsetTable.hxx"],
    language="c++",
    extra_compile_args=["/O2", "/std:c++17"] if sys.platform == "win32" else
                       ["-O3", "-std=c++17", "-Wall", "-Wextra", "-pthread"],
    extra_link_args=[] if sys.platform == "win32" else ["-pthread"],
)])
