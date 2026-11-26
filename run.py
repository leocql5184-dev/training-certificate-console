"""One-command local setup, build, run, and verification."""
from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / '.runtime'
VENV = ROOT / '.venv'
PYTHON = VENV / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def run(args: list[str], cwd: Path = ROOT) -> None:
    print('+ ' + ' '.join(str(a) for a in args), flush=True)
    subprocess.run(args, cwd=cwd, check=True)


def digest(*paths: Path) -> str:
    return hashlib.sha256(b''.join(p.read_bytes() for p in paths if p.exists())).hexdigest()


def prepare() -> None:
    RUNTIME.mkdir(exist_ok=True)
    if not PYTHON.exists():
        print('Creating local Python environment...', flush=True)
        venv.EnvBuilder(with_pip=True).create(VENV)
    requirement = ROOT / 'requirements.lock.txt'
    if not requirement.exists():
        requirement = ROOT / 'requirements.txt'
    stamp = RUNTIME / 'python-dependencies.sha256'
    expected = digest(requirement)
    if not stamp.exists() or stamp.read_text() != expected:
        run([str(PYTHON), '-m', 'pip', 'install', '-r', str(requirement)])
        stamp.write_text(expected)
    npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
    if not npm:
        raise RuntimeError('Node.js and npm are required. Install Node.js 22.12+ or 24 LTS, then run again.')
    frontend = ROOT / 'frontend'
    manifest = frontend / 'package.json'
    lock = frontend / 'package-lock.json'
    stamp = RUNTIME / 'frontend-dependencies.sha256'
    expected = digest(manifest, lock)
    if not (frontend / 'node_modules').exists() or not stamp.exists() or stamp.read_text() != expected:
        run([npm, 'ci' if lock.exists() else 'install', '--no-fund', '--no-audit'], frontend)
        stamp.write_text(digest(manifest, lock))
    run([npm, 'run', 'build'], frontend)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--verify', action='store_true', help='Build frontend and run isolated API acceptance tests.')
    parser.add_argument('--benchmark', action='store_true', help='Run isolated 100,000-row HTTP export benchmark.')
    parser.add_argument('--prepare', action='store_true', help='Install dependencies and build without starting server.')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('--port must be between 1 and 65535')
    os.chdir(ROOT)
    try:
        prepare()
        if args.verify:
            run([str(PYTHON), '-m', 'pytest', '-q', 'tests'])
        if args.benchmark:
            run([str(PYTHON), str(ROOT / 'scripts' / 'benchmark_export.py')])
        if args.verify or args.benchmark or args.prepare:
            return 0
        print(f'\nOcean Academy: http://127.0.0.1:{args.port}\nPress Ctrl+C to stop.\n', flush=True)
        run([str(PYTHON), '-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', str(args.port)])
        return 0
    except KeyboardInterrupt:
        return 0
    except (subprocess.CalledProcessError, RuntimeError) as error:
        print(f'Startup failed: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
