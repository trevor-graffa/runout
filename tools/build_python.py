"""Build Rust into this checkout, without changing the active conda environment."""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import sysconfig

ROOT = Path(__file__).resolve().parents[1]
env = dict(os.environ, PYO3_PYTHON=sys.executable, PYO3_BUILD_EXTENSION_MODULE="1")
subprocess.run(["cargo", "build", "--locked", "--release", "--lib", "--features", "python"], cwd=ROOT, env=env, check=True)
library = ROOT / "target/release" / ("_native.dll" if sys.platform == "win32" else "lib_native.dylib" if sys.platform == "darwin" else "lib_native.so")
target = ROOT / "poker_engine" / ("_native" + sysconfig.get_config_var("EXT_SUFFIX"))
shutil.copy2(library, target)
print(f"Rust extension ready: {target}")
