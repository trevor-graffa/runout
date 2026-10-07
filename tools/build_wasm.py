from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
generator = shutil.which("wasm-bindgen") or str(ROOT / ".tools/bin/wasm-bindgen")
subprocess.run(["cargo", "build", "--locked", "--release", "--lib", "--target", "wasm32-unknown-unknown", "--features", "wasm"], cwd=ROOT, check=True)
subprocess.run([generator, "target/wasm32-unknown-unknown/release/_native.wasm", "--target", "web",
                "--out-dir", "web/pkg", "--out-name", "poker_engine"], cwd=ROOT, check=True)
print("Browser assets built in web/pkg. Serve web/ using any static HTTP host.")
