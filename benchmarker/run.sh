#!/usr/bin/env bash
# Runs a congested-area benchmark against the local DSS pool in ../dss-dev: simulated USS users all
# fly in the same tiny spot while their number grows step by step, until throughput falls off.
#
# Usage: ./run.sh <test> [spread] [subscriptions] [options]
#        The words after <test> can come in any order.
#
# Test, what every flight does:
#   scd           creates an SCD op intent (Accepted), activates it, then deletes it
#   rid           creates a NetRID ISA, then deletes it; 8 RID subscriptions cover the spot
#   both          both of the above, with SCD's flight timing
#
# Spread, how users use the 3 DSS instances (default: sticky):
#   sticky        all instances at once; each user sticks to its own DSS
#   random        all instances at once; every call goes to a random DSS
#   sequential    one instance at a time: dss-0, then dss-1, then dss-2
#
# SCD subscriptions, for scd and both (default: explicit):
#   explicit      one shared subscription, created before the ramp
#   implicit      the DSS gives each op intent its own
#
# Options:
#   --steps N     also stop each ramp after N steps, for a short trial run
#   --details     record every request and response in the report (much larger report)
#   --show-config also print the full configuration (it is always saved as config.json)
#   --dry-run     write the configuration and summary, without running the benchmarker
#   -h, --help    show this help
#
# Examples:
#   ./run.sh scd                        SCD, sticky, one shared subscription
#   ./run.sh scd random implicit        SCD, a random DSS per call, a subscription per op intent
#   ./run.sh rid sequential             NetRID, one DSS instance at a time
#   ./run.sh both --steps 2 --dry-run   check a short SCD + NetRID run without starting it
#
# Every run prints a summary of what it will do, then saves everything in output/<date>-<time>/:
# summary.txt (that summary), config.json (exactly what ran), netem.env (the latency settings
# ../dss-dev/netem.sh last applied, if any), report.json and scalability_curve.png, plus
# intermediate<N>/ after each instance for sequential runs.
# Needs the pool and mock-oauth running in ../dss-dev, and jsonnet on this machine.

set -euo pipefail
cd "$(dirname "$0")"

usage() {
  sed -n '2,/^$/s/^# \{0,1\}//p' "$0"
  exit "${1:-2}"
}

fail() {
  echo "$*" >&2
  echo "See ./run.sh --help" >&2
  exit 2
}

kind=${1:-}
case "$kind" in
  scd|rid|both) shift ;;
  -h|--help|help) usage 0 ;;
  "") usage ;;
  *) fail "Unknown test '$kind': use scd, rid or both" ;;
esac

spread=""
subs=""
steps=0
details=false
show_config=false
dry_run=false
while [ $# -gt 0 ]; do
  case "$1" in
    sticky|random|sequential)
      [ -z "$spread" ] || fail "Choose one spread: sticky, random or sequential"
      spread=$1
      shift
      ;;
    explicit|implicit)
      [ -z "$subs" ] || fail "Choose one of explicit or implicit"
      subs=$1
      shift
      ;;
    --steps)
      [ $# -ge 2 ] || fail "--steps needs a number"
      steps=$2
      shift 2
      ;;
    --details) details=true; shift ;;
    --show-config) show_config=true; shift ;;
    --dry-run) dry_run=true; shift ;;
    -h|--help|help) usage 0 ;;
    *) fail "Unknown word '$1'" ;;
  esac
done

[ "$kind" != rid ] || [ -z "$subs" ] || fail "'$subs' is about SCD subscriptions: use it with scd or both"
[[ $steps =~ ^[0-9]+$ ]] || fail "--steps needs a whole number"
command -v jsonnet >/dev/null || { echo "jsonnet is not installed" >&2; exit 1; }

spread=${spread:-sticky}
subs=${subs:-explicit}
type="$kind, $spread"
[ "$kind" = rid ] || type+=", $subs SCD subscriptions"

out=output/$(date +%Y%m%d-%H%M%S)
[ ! -e "$out" ] || { echo "$out already exists: wait a second and run again" >&2; exit 1; }
mkdir -p "$out"

# The same parameters render both the configuration and its summary.
params=(--tla-str test="$kind" --tla-str spread="$spread" --tla-str scd_subscriptions="$subs"
  --tla-code steps="$steps" --tla-code details="$details")
summary_of='function(test, spread, scd_subscriptions, steps, details)
  (import "wrapper.jsonnet")(test, spread, scd_subscriptions, steps, details).summary'
if ! jsonnet "${params[@]}" wrapper.jsonnet > "$out/config.json" \
  || ! summary=$(jsonnet -S "${params[@]}" -e "$summary_of"); then
  rm -r "$out"
  exit 1
fi

netem_state=../dss-dev/.netem-dss-dev_cluster
if [ -f "$netem_state" ]; then
  cp "$netem_state" "$out/netem.env"
  latency="netem seed $(sed -n 's/^SEED=//p' "$netem_state"): round trip $(sed -n 's/^INTRA_RTT_MS=//p' "$netem_state") ms"
  latency+=" within an instance, $(sed -n 's/^INTER_RTT_MS=//p' "$netem_state") ms between instances"
  latency+=" (as last applied; ../dss-dev/netem.sh check dss-0 confirms it is still in place)"
else
  echo "# No saved netem.sh settings: no latency was applied, or it was cleared." > "$out/netem.env"
  latency="none: no saved netem.sh settings"
fi

{
  echo "Benchmark: $type"
  echo "$summary"
  printf '  %-14s %s\n' latency "$latency" results "$out/"
} | tee "$out/summary.txt"

if $show_config; then
  echo
  echo "Configuration ($out/config.json):"
  cat "$out/config.json"
fi

run=(docker compose run --rm benchmarker
  uv run python monitoring/benchmarker/benchmark.py
  --config "file:///benchmarker/$out/config.json"
  --output "/benchmarker/$out")

echo
if $dry_run; then
  echo "Dry run, not starting the benchmarker. Command:"
  printf '  '
  printf '%q ' "${run[@]}"
  echo
  exit 0
fi
"${run[@]}"
echo
echo "Done: results in $out/"
