#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
if ! command -v swiftc >/dev/null 2>&1; then
  echo "Native model checks require a Swift toolchain (swiftc); they were not run." >&2
  exit 69
fi
build_dir="$(mktemp -d "${TMPDIR:-/tmp}/haskapp-model-checks.XXXXXX")"
trap 'rm -rf "$build_dir"' EXIT
swiftc "$root/modules/haskapp-native/ios/PlannerModels.swift" "$root/modules/haskapp-native/ios/LectureDetailModels.swift" "$root/native-tests/PlannerModelChecks.swift" -o "$build_dir/checks"
"$build_dir/checks" "$root/data/official-timetable-2026-semester2.json"
