"""Install a wheel outside the checkout and smoke-test API, CLI, and ABI reuse."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

wheel = Path(sys.argv[1]).resolve()
with zipfile.ZipFile(wheel) as archive:
    names = archive.namelist()
    assert 'poker_engine/py.typed' in names
    assert any(name.endswith('/_native.abi3.so') or name.endswith('/_native.pyd') for name in names)
    assert not any('_cpp_reference' in name or name.endswith('omaha.bin.gz') for name in names)
    assert any(name.endswith('/LICENSE.txt') for name in names)
with tempfile.TemporaryDirectory(prefix='poker-wheel-') as folder:
    subprocess.run([sys.executable,'-m','pip','install','--no-deps','--no-index','--target',folder,str(wheel)],check=True)
    env = dict(os.environ,PYTHONPATH=folder)
    interpreters = [sys.executable, *sys.argv[2:]]
    for python in interpreters:
        code = """
from poker_engine import Calculator, Range, _native
assert _native.BACKEND == 'rust'
assert _native.__file__.endswith(('.abi3.so','.pyd'))
calc=Calculator({'Hero':'As2cJhJd','Villain':'Ah2dKsKh'},game='omaha8',board='3d4h8sJcQd')
r=calc.exact()
assert [p.equity for p in r.players]==[.75,.25]
assert r.rows()[0]['player']=='Hero'
assert '<table>' in r._repr_html_()
assert len(Range.parse('AA$ds',game='omaha'))==864
print('Installed Rust API passed:',_native.__file__)
"""
        subprocess.run([python,'-c',code],cwd=folder,env=env,check=True)
        raw = subprocess.check_output([python,'-m','poker_engine','AsAh','KsKh','--board','2c3d4h8s9c','--json'],cwd=folder,env=env,text=True)
        assert json.loads(raw)['players'][0]['equity']==1
    subprocess.run([str(Path(folder)/'bin/poker-engine'),'AsAh','KsKh','--board','2c3d4h8s9c'],cwd=folder,env=env,check=True)
print('Wheel installation, installed console command, and interpreter ABI smoke passed.')
