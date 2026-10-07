"""Same-machine, shared-input evaluation and compiled-range simulation comparison."""
import argparse
import gzip
import hashlib
import json
import math
import platform
import random
import statistics
import subprocess
import tempfile
import time
from pathlib import Path

from poker_engine import _cpp_reference as cpp, _native as rust, parse_range

ROOT = Path(__file__).resolve().parents[1]
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cpp', required=True)
    parser.add_argument('--rust', default=str(ROOT/'target/release/benchmark'))
    parser.add_argument('--output', default=str(ROOT/'benchmarks/comparison.json'))
    parser.add_argument('--repeats', type=int, default=5)
    parser.add_argument('--samples', type=int, default=1_000_000)
    args = parser.parse_args()
    rng = random.Random(17171)
    data = bytes(c for _ in range(100000) for c in rng.sample(range(52),9))
    results = []
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder)/'cards.bin'; path.write_bytes(data)
        for count in (100000,100):
            runs = {}
            for backend, executable in [('cpp',args.cpp),('rust',args.rust)]:
                for _ in range(args.repeats):
                    output = subprocess.check_output([executable,str(path),str(count),str(10_000_000//count)],text=True)
                    for line in output.splitlines():
                        name,rate,checksum = line.split()
                        rows = runs.setdefault((backend,name),[])
                        rows.append((float(rate),int(checksum)))
            for (backend,name),rows in runs.items():
                assert len({checksum for _,checksum in rows}) == 1
                if backend == 'rust':
                    assert rows[0][1] == runs['cpp',name][0][1], (name, rows, runs['cpp',name])
                results.append(dict(kind='evaluation',backend=backend,case=name,working_set=count,
                    per_second=statistics.median(r for r,_ in rows),checksum=rows[0][1]))
    cpp.initialize_omaha(gzip.decompress((ROOT/'poker_engine/data/omaha.bin.gz').read_bytes()))
    cases = [
        ('holdem_fixed_exact',0,['AsAh','KsKh'],True),
        ('holdem_ranges_mc',0,['TT+,AQs+,AKo','random'],False),
        ('omaha_fixed_mc',1,['AsKsQcJd','AhKhQdJc'],False),
        ('omaha_ranges_mc',1,['AA$ds','random'],False),
        ('omaha8_ranges_mc',2,['A2','random'],False),
    ]
    for name,game,texts,exact in cases:
        entries = [list(parse_range(text,game=['holdem','omaha','omaha8'][game]).entries) for text in texts]
        exact_reference = None
        for backend,module in [('cpp',cpp),('rust',rust)]:
            start=time.perf_counter(); compiled=[module.compile_range(game,r) for r in entries]
            setup=time.perf_counter()-start
            for threads in ([1] if exact else [1,4]):
                def run(): return module.simulate(compiled,[],[],game,exact,args.samples,1234,2_000_000,0,threads)
                run(); times=[]
                for _ in range(args.repeats):
                    start=time.perf_counter(); result=run(); times.append(time.perf_counter()-start)
                if exact:
                    if exact_reference is None: exact_reference=result
                    else:
                        assert result['outcomes']==exact_reference['outcomes']
                        for a,b in zip(result['players'],exact_reference['players']):
                            for key in a: assert abs(a[key]-b[key])<1e-12,(key,a,b)
                row=dict(kind='simulation',backend=backend,case=name,threads=threads,
                    outcomes=result['outcomes'],per_second=result['outcomes']/statistics.median(times),
                    setup_seconds=setup,players=result['players'])
                results.append(row); print(name,backend,threads,round(row['per_second']))
    report=dict(platform=platform.platform(),dataset_sha256=hashlib.sha256(data).hexdigest(),
        samples=args.samples,repeats=args.repeats,
        rustc=subprocess.check_output(['rustc','--version'],text=True).strip(),
        cpp_compiler=subprocess.check_output(['c++','--version'],text=True).splitlines()[0],
        results=results)
    for row in results:
        if row['kind']=='simulation' and row['backend']=='rust' and '_mc' in row['case']:
            reference=next(r for r in results if r['kind']=='simulation' and r['backend']=='cpp' and r['case']==row['case'] and r['threads']==row['threads'])
            for a,b in zip(row['players'],reference['players']):
                assert abs(a['equity']-b['equity']) < 6*math.hypot(a['stderr'],b['stderr']) + 1e-12
    Path(args.output).write_text(json.dumps(report,indent=2)+'\n')
    for row in results:
        if row['kind']=='evaluation': print(row['working_set'],row['case'],row['backend'],round(row['per_second']/1e6,1),'M/s')
if __name__=='__main__': main()
