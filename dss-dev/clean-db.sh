#!/usr/bin/env bash
# Deletes the test records straight from CockroachDB, so tests start from an empty pool without
# recreating containers or volumes and without reapplying netem: RID ISAs and RID subscriptions, and
# SCD operational intents and SCD subscriptions (implicit ones included). Nothing else is touched:
# SCD constraints and USS availabilities, the schema versions and lock rows the migrations seeded,
# and the aux_ pool metadata all stay.
#
# Usage: ./clean-db.sh [--instance N] [--dry-run] [--yes]
#   --instance N  connect with instance-N's client.root certificate pair, to 0.crdb.instance-N.test
#                 (default 0); the data is shared by the whole cluster, so any instance clears all of it
#   --dry-run     show what would be deleted, without deleting
#   --yes         delete without asking first
#   -h, --help    show this help
#
# The SQL runs in a throwaway cockroach container on the pool's network, with the CA bundle and the
# instance's client.root pair mounted, as crdb-init does. Stop any load first (benchmarker, dss-test
# injections): records written while this runs may survive it.

set -euo pipefail
cd "$(dirname "$0")"

usage() {
  sed -n '2,/^$/s/^# \{0,1\}//p' "$0"
  exit "${1:-2}"
}

instance=0
dry_run=false
yes=false
while [ $# -gt 0 ]; do
  case "$1" in
    --instance)
      [ $# -ge 2 ] || usage
      instance=$2
      shift 2
      ;;
    --dry-run) dry_run=true; shift ;;
    --yes) yes=true; shift ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown option '$1'" >&2; usage ;;
  esac
done

NETWORK=dss-dev_cluster
IMAGE=cockroachdb/cockroach:v24.1.3
HOST=0.crdb.instance-$instance.test:26257
TABLES=(rid.identification_service_areas rid.subscriptions scd.scd_operations scd.scd_subscriptions)

[[ $instance =~ ^[0-9]+$ ]] || { echo "--instance needs a number" >&2; exit 2; }
for f in ca-bundle.crt "instance-$instance/client.root.crt" "instance-$instance/client.root.key"; do
  [ -f "$f" ] || { echo "Missing $PWD/$f" >&2; exit 1; }
done
docker network inspect "$NETWORK" >/dev/null 2>&1 || { echo "Network $NETWORK not found: is the pool up?" >&2; exit 1; }

# Runs SQL from stdin as root and prints the result as tab-separated values.
sql() {
  docker run --rm -i --network "$NETWORK" \
    -v "$PWD/ca-bundle.crt:/certs/ca.crt:ro" \
    -v "$PWD/instance-$instance/client.root.crt:/certs/client.root.crt:ro" \
    -v "$PWD/instance-$instance/client.root.key:/certs/client.root.key:ro" \
    "$IMAGE" sql --certs-dir=/certs --host="$HOST" --format=tsv
}

# Row counts of the given tables, as "table<TAB>rows" lines.
count_rows() {
  local t parts=()
  for t in "$@"; do parts+=("SELECT '$t' AS \"table\", count(*) AS \"rows\" FROM $t"); done
  printf '%s\nUNION ALL\n' "${parts[@]}" | sed '$d' | { cat; echo ';'; } | sql | tail -n +2
}

echo "Through $HOST with instance-$instance's root certificate:"
before=$(count_rows "${TABLES[@]}")
printf '  %-40s %s\n' table rows
while IFS=$'\t' read -r t n; do printf '  %-40s %s\n' "$t" "$n"; done <<< "$before"
total=$(awk -F'\t' '{s += $2} END {print s + 0}' <<< "$before")

statement="TRUNCATE TABLE $(IFS=,; echo "${TABLES[*]}" | sed 's/,/, /g');"
if $dry_run; then
  echo
  echo "Dry run, nothing deleted. Would run:"
  echo "  $statement"
  exit 0
fi
if [ "$total" -eq 0 ]; then
  echo "Nothing to delete."
  exit 0
fi
if ! $yes; then
  read -r -p "Delete these $total rows from the whole pool? Type yes: " answer
  [ "$answer" = yes ] || { echo "Nothing deleted."; exit 1; }
fi

# One statement for all the tables, so the foreign key from operational intents to subscriptions is
# satisfied.
sql <<< "$statement" >/dev/null
echo "Deleted. Now:"
while IFS=$'\t' read -r t n; do printf '  %-40s %s\n' "$t" "$n"; done < <(count_rows "${TABLES[@]}")
