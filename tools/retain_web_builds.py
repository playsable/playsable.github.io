"""Prune hashed web exports before staging the release commit."""
import argparse
import json
from pathlib import Path
import re
import subprocess

HASH = r"[0-9a-f]{7,40}"
ASSET = re.compile(rf"index\.({HASH})\.(?:(?:[\w-]+\.)*js|wasm|pck)")
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("play", type=Path)
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
play = args.play.resolve(strict=True)

def git(*arguments):
    return subprocess.check_output(["git", "-C", str(play), *arguments], text=True).strip()

prefix = git("rev-parse", "--show-prefix")
current = json.loads((play / "version.json").read_bytes())
builds = [current]
# The working manifest is the candidate. Find the latest distinct committed build,
# including when this script is rerun on the already committed release.
for commit in git("log", "--format=%H", "--", "version.json").splitlines():
    record = json.loads(git("show", f"{commit}:{prefix}version.json"))
    if record["sha"] != current["sha"]:
        builds.append(record)
        break
keep = set()
engines = set()
for build in builds:
    for kind in ("pck", "wasm", "js"):
        name = build.get(kind) or f"index.{build['sha']}.{kind}"
        if not ASSET.fullmatch(name) or not (play / name).is_file():
            raise SystemExit(f"Missing or invalid retained {kind}: {name}")
        keep.add(name)
        if kind == "js":
            engines.add(name[:-3] + ".")
stale = []
for file in sorted(play.iterdir()):
    if not ASSET.fullmatch(file.name) or not file.is_file() or file.name in keep:
        continue
    if file.name.endswith(".js") and any(file.name.startswith(engine) for engine in engines):
        continue
    stale.append(file)
if args.check and stale:
    raise SystemExit("Stale web assets: " + ", ".join(f.name for f in stale))
for file in stale:
    file.unlink()
print("Retained", ", ".join(b["sha"] for b in builds), "and their runtimes;", len(stale), "stale files.")
