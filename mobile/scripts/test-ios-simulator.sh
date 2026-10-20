#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != Darwin ]]; then
  echo 'iOS simulator verification requires a Mac with Xcode. Portable checks: npm run verify' >&2
  exit 2
fi
for command in xcodebuild xcrun ruby node; do
  command -v "$command" >/dev/null || { echo "Required command missing: $command" >&2; exit 2; }
done
[[ -d ios/Haskapp.xcworkspace ]] || { echo 'Run Expo prebuild and pod install first; see README.md.' >&2; exit 2; }

devices_file=$(mktemp /tmp/haskapp-simulators.XXXXXX)
trap 'rm -f "$devices_file"' EXIT
xcrun simctl list devices available --json > "$devices_file"
simulator_id=$(node - "$devices_file" <<'NODE'
const fs = require('node:fs');
const inventory = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const all = Object.entries(inventory.devices)
  .filter(([runtime]) => runtime.includes('.iOS-'))
  .sort(([a], [b]) => b.localeCompare(a, undefined, {numeric: true}))
  .flatMap(([, devices]) => devices.filter(d => d.isAvailable && d.name.startsWith('iPhone')));
const requested = process.env.HASKAPP_SIMULATOR_UDID;
const chosen = requested ? all.find(d => d.udid === requested) : all.find(d => d.state === 'Booted') || all[0];
if (!chosen) {
  console.error(requested ? 'The requested available iPhone simulator was not found.' : 'Install an iPhone simulator runtime in Xcode Settings → Components.');
  process.exit(2);
}
console.log(chosen.udid);
NODE
)

bash native-tests/run-model-checks.sh
ruby scripts/add-ui-tests.rb
result_root="${HASKAPP_TEST_OUTPUT:-/tmp/haskapp-ios-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$result_root"
echo "Using iPhone Simulator $simulator_id. Test results: $result_root"
# Destination is always a verified simulator UDID. Ad-hoc simulator signing
# preserves Keychain access without a developer certificate or profile.
xcodebuild -workspace ios/Haskapp.xcworkspace -scheme Haskapp \
  -configuration Release -destination "platform=iOS Simulator,id=$simulator_id" \
  -parallel-testing-enabled NO -collect-test-diagnostics never -jobs 3 -derivedDataPath "$result_root/DerivedData" \
  -resultBundlePath "$result_root/Haskapp.xcresult" \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM= test 2>&1 | tee "$result_root/xcodebuild.log"
