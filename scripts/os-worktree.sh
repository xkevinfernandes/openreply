#!/usr/bin/env bash
# Set up a DM OS stream worktree: own branch, own DB, own port.
# Run from anywhere inside the openreply checkout (not inside another worktree).
#
#   scripts/os-worktree.sh <name> <port> [--fresh] [--no-dev]
#
# Creates .worktrees/os-<name> on branch os/<name> from kevin, installs deps,
# creates (or with --fresh: recreates) DB openreply_os_<name>, migrates,
# generates the client, seeds (scripts/os-seed-dev.ts) and starts
# `next dev` with OS_MOCK=1 on <port> (unless --no-dev).
# Session cookie for the browser: authjs.session-token=local-dev-session.
set -euo pipefail

name="${1:-}"; port="${2:-}"
if [[ -z "$name" || -z "$port" ]]; then
  echo "usage: scripts/os-worktree.sh <name> <port> [--fresh] [--no-dev]" >&2
  exit 1
fi
shift 2
fresh=0; dev=1
for a in "$@"; do
  case "$a" in
    --fresh) fresh=1 ;;
    --no-dev) dev=0 ;;
    *) echo "unknown option $a" >&2; exit 1 ;;
  esac
done

root="$(git rev-parse --show-toplevel)"
gitdir="$(git -C "$root" rev-parse --git-common-dir)"
exclude="$gitdir/info/exclude"
grep -qx ".worktrees/" "$exclude" 2>/dev/null || echo ".worktrees/" >> "$exclude"

wt="$root/.worktrees/os-$name"
db="openreply_os_${name//-/_}"
export DATABASE_URL="postgresql://${PGUSER:-Kevin}@localhost:5432/$db"

if [[ ! -d "$wt" ]]; then
  git -C "$root" worktree add "$wt" -b "os/$name" kevin
fi
cd "$wt"
[[ -d node_modules ]] || npm ci

if [[ $fresh == 1 ]]; then dropdb --if-exists "$db"; fi
createdb "$db" 2>/dev/null || echo "DB $db exists, reusing it (pass --fresh to recreate)."

npx prisma migrate deploy
npx prisma generate
npx tsx scripts/os-seed-dev.ts

echo "Worktree $wt · branch os/$name · DB $db · http://localhost:$port/os"
if [[ $dev == 1 ]]; then
  OS_MOCK=1 NEXTAUTH_SECRET=local-dev-only NEXTAUTH_URL="http://localhost:$port" npx next dev -p "$port"
fi
