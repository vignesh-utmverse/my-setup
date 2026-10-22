#!/usr/bin/env bash
# Emulates network latency inside the local DSS pool (docker-compose.yaml) with tc netem.
#
# Builds on the InterUSS local pool (interuss/monitoring build/dev/startup/db-entrypoint.sh): every
# pool container gets a prio qdisc on its cluster interface with one netem band per destination /24,
# that is per instance:
#   intra  same instance     172.19.<i>.0/24  DSS <-> its own CRDB nodes, CRDB <-> CRDB of that instance
#   inter  other instances   172.19.<j>.0/24  CRDB <-> CRDB across instances
# Traffic to the gateway (the host: published ports, a benchmarker on --network host) and to the
# dynamic range 172.19.255.0/24 (mock-oauth, init jobs, anything else joined to the network) is
# not delayed. Subnet, gateway and dynamic range are read from the network.
#
# Latencies are round-trip times drawn at random, uniformly within a range: one per instance for
# intra traffic, one per pair of instances for inter traffic. Each stays fixed until the next
# apply, as on a real network; netem delays each direction by half of it. The draw is fixed by a
# seed, so a run can be repeated.
#
# Usage:
#   ./netem.sh apply                    new random latencies for every running pool container
#   ./netem.sh reapply [container...]   the last latencies again, e.g. after a container restarted
#   ./netem.sh show    [container...]   qdiscs with packet counters
#   ./netem.sh clear   [container...]   remove the rules
#   ./netem.sh check   [container]      ping every other address on the network (default: dss-0)
#
# Settings for apply:
#   INTRA_RTT_MS  range within an instance, in ms (default 0.2-2)
#   INTER_RTT_MS  range between two instances, in ms (default 20-100)
#   SEED          repeats an earlier draw (default: a new one, printed by apply)
# e.g. INTRA_RTT_MS=2-10 ./netem.sh apply, or a fixed value: INTER_RTT_MS=50 ./netem.sh apply
#
# The rules live in the container's network namespace, so run reapply whenever a pool container
# restarts or is recreated (including restarts from restart: on-failure). apply saves its seed and
# ranges for reapply in .netem-<network> next to this script.
#
# Other settings: NETWORK (default dss-dev_cluster), NETEM_IMAGE (default nicolaka/netshoot:v0.13,
# any image with tc, ip and ping).

set -euo pipefail

NETWORK=${NETWORK:-dss-dev_cluster}
IMAGE=${NETEM_IMAGE:-nicolaka/netshoot:v0.13}
STATE=$(dirname "$0")/.netem-$NETWORK

usage() {
  sed -n '2,/^$/s/^# \{0,1\}//p' "$0"
  exit 2
}

ip2int() {
  local IFS=.
  # shellcheck disable=SC2086
  set -- $1
  echo $(( ($1 << 24) + ($2 << 16) + ($3 << 8) + $4 ))
}

in_cidr() {
  local mask=$(( (0xFFFFFFFF << (32 - ${2#*/})) & 0xFFFFFFFF ))
  (( ($(ip2int "$1") & mask) == ($(ip2int "${2%/*}") & mask) ))
}

# Third byte of an address: the instance.
instance_of() {
  local a=${1%.*}
  echo "${a##*.}"
}

# ---------------------------------------------------------------- network layout
read -r SUBNET GATEWAY IP_RANGE < <(docker network inspect "$NETWORK" \
  --format '{{range .IPAM.Config}}{{.Subnet}} {{.Gateway}} {{.IPRange}}{{end}}')
# An unset ip_range prints as "invalid Prefix".
if [[ ${IP_RANGE:-} != */* ]]; then
  echo "$NETWORK has no ip_range, so it predates the static IPs in docker-compose.yaml." >&2
  echo "Recreate it: docker compose --profile init down && docker compose --profile no-init up -d" >&2
  exit 1
fi
PREFIX=$(cut -d. -f1-2 <<< "$SUBNET")

# Every running container on the network (NET) and the pool ones, with a fixed address outside the
# dynamic range (POOL), as name -> address. ORDER lists the pool by address, INSTANCES the instances
# that have a running container.
declare -A NET POOL
while read -r name addr; do
  [ -n "$name" ] || continue
  NET[$name]=${addr%/*}
  in_cidr "${addr%/*}" "$IP_RANGE" || POOL[$name]=${addr%/*}
done < <(docker network inspect "$NETWORK" \
  --format '{{range .Containers}}{{.Name}} {{.IPv4Address}}{{"\n"}}{{end}}')
mapfile -t ORDER < <(for n in "${!POOL[@]}"; do echo "${POOL[$n]} $n"; done | sort -V | cut -d' ' -f2)
mapfile -t INSTANCES < <(for n in "${!POOL[@]}"; do instance_of "${POOL[$n]}"; done | sort -nu)

# ---------------------------------------------------------------- latencies
# "lo-hi" or "x" in ms -> "lo hi" in microseconds.
range_us() {
  [[ $1 =~ ^[0-9]+(\.[0-9]+)?(-[0-9]+(\.[0-9]+)?)?$ ]] || { echo "bad range '$1': want e.g. 2-10 or 50" >&2; exit 1; }
  awk -v r="$1" 'BEGIN { if (split(r, a, "-") == 1) a[2] = a[1]; printf "%d %d\n", a[1] * 1000, a[2] * 1000 }'
}

load_ranges() {
  local r
  r=$(range_us "$INTRA_RTT_MS"); read -r INTRA_LO INTRA_HI <<< "$r"
  r=$(range_us "$INTER_RTT_MS"); read -r INTER_LO INTER_HI <<< "$r"
}

# Uniform draw in [lo, hi] for a key (an instance, or a pair "a-b"), fixed by SEED.
draw_us() {
  local h
  h=$(( 16#$(printf '%s' "$SEED:$1" | md5sum | cut -c1-8) ))
  echo $(( $2 + h % ($3 - $2 + 1) ))
}

# Round-trip time in microseconds between two instances.
rtt_us() {
  if [ "$1" = "$2" ]; then draw_us "$1" "$INTRA_LO" "$INTRA_HI"
  elif [ "$1" -lt "$2" ]; then draw_us "$1-$2" "$INTER_LO" "$INTER_HI"
  else draw_us "$2-$1" "$INTER_LO" "$INTER_HI"
  fi
}

ms() {
  printf '%d.%d' $(( $1 / 1000 )) $(( $1 % 1000 / 100 ))
}

print_matrix() {
  echo "seed $SEED: intra RTT $INTRA_RTT_MS ms, inter RTT $INTER_RTT_MS ms"
  local a b
  printf '  %-12s' "RTT ms"
  for b in "${INSTANCES[@]}"; do printf '%12s' "instance-$b"; done
  echo
  for a in "${INSTANCES[@]}"; do
    printf '  %-12s' "instance-$a"
    for b in "${INSTANCES[@]}"; do printf '%12s' "$(ms "$(rtt_us "$a" "$b")")"; done
    echo
  done
}

# ---------------------------------------------------------------- per-container programs
# Runs a shell program in a throwaway container that shares <container>'s network namespace.
# The program gets ADDR (the container's address) and iface (its interface on the network).
in_netns() {
  local name=$1 prog=$2; shift 2
  docker run --rm --net "container:$name" --cap-add NET_ADMIN -e "ADDR=${NET[$name]}" "$@" "$IMAGE" sh -c '
    set -e
    iface=$(ip -o -4 addr show | awk -v a="$ADDR/" "index(\$4, a) == 1 {print \$2; exit}")
    [ -n "$iface" ] || { echo "no interface with address $ADDR" >&2; exit 1; }
    '"$prog"
}

# RULES is "<destination /24>=<one-way delay in us> ...".
APPLY='
tc qdisc del dev "$iface" root 2>/dev/null || true
set -- $RULES
# Band 1:1 takes whatever no filter matches and is not delayed; bands 1:2 onwards delay one /24 each.
tc qdisc add dev "$iface" root handle 1: prio bands $(($# + 1)) priomap 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
tc filter add dev "$iface" parent 1: protocol ip prio 1 u32 match ip dst "$GATEWAY/32" flowid 1:1
tc filter add dev "$iface" parent 1: protocol ip prio 1 u32 match ip dst "$IP_RANGE" flowid 1:1
band=2
for rule; do
  # tc reads class minors and qdisc handles as hex. limit raises the netem queue from 1000 packets,
  # which a delayed band under load can overflow.
  tc qdisc add dev "$iface" parent 1:$(printf %x $band) handle $(printf %x $((band + 16))): \
    netem limit 100000 delay "${rule#*=}us"
  tc filter add dev "$iface" parent 1: protocol ip prio 2 u32 match ip dst "${rule%=*}" flowid 1:$(printf %x $band)
  band=$((band + 1))
done
'

SHOW='tc -s qdisc show dev "$iface"'

CLEAR='tc qdisc del dev "$iface" root 2>/dev/null || true'

# TARGETS is "<name>,<address>,<expected RTT> ...".
CHECK='
for t in $TARGETS; do
  IFS=, read -r name addr expected <<EOF
$t
EOF
  avg=$(ping -q -n -c 5 -i 0.2 -W 2 "$addr" | awk -F" = " "/min\\/avg/ {split(\$2, v, \"/\"); printf \"%.1f\", v[2]}")
  printf "  %-26s %-15s %9s %9s\n" "$name" "$addr" "$expected" "${avg:-no reply}"
done
'

# Sets names to the containers given on the command line, or the whole pool, checking each one.
select_targets() {
  if [ $# -eq 0 ]; then
    [ ${#ORDER[@]} -gt 0 ] || { echo "no pool containers are running on $NETWORK" >&2; exit 1; }
    names=("${ORDER[@]}")
    return
  fi
  names=()
  local name
  for name in "$@"; do
    [ -n "${POOL[$name]:-}" ] || { echo "$name is not a running pool container on $NETWORK" >&2; exit 1; }
    names+=("$name")
  done
}

apply_rules() {
  local name i j rules
  for name in "${names[@]}"; do
    i=$(instance_of "${POOL[$name]}")
    rules=""
    for j in "${INSTANCES[@]}"; do
      rules+=" $PREFIX.$j.0/24=$(( $(rtt_us "$i" "$j") / 2 ))"
    done
    echo "  $name ${POOL[$name]}"
    in_netns "$name" "$APPLY" -e "GATEWAY=$GATEWAY" -e "IP_RANGE=$IP_RANGE" -e "RULES=$rules"
  done
}

# ---------------------------------------------------------------- commands
cmd=${1:-}
[ $# -gt 0 ] && shift
case "$cmd" in
  apply)
    [ $# -eq 0 ] || usage
    SEED=${SEED:-$(( RANDOM * 32768 + RANDOM ))}
    INTRA_RTT_MS=${INTRA_RTT_MS:-0.2-2}
    INTER_RTT_MS=${INTER_RTT_MS:-20-100}
    load_ranges
    select_targets
    printf 'SEED=%s\nINTRA_RTT_MS=%s\nINTER_RTT_MS=%s\n' "$SEED" "$INTRA_RTT_MS" "$INTER_RTT_MS" > "$STATE"
    print_matrix
    apply_rules
    ;;
  reapply)
    [ -f "$STATE" ] || { echo "nothing to reapply: run apply first" >&2; exit 1; }
    # shellcheck disable=SC1090
    . "$STATE"
    load_ranges
    select_targets "$@"
    print_matrix
    apply_rules
    ;;
  show)
    select_targets "$@"
    for name in "${names[@]}"; do
      echo "== $name ${POOL[$name]}"
      in_netns "$name" "$SHOW"
    done
    ;;
  clear)
    select_targets "$@"
    for name in "${names[@]}"; do
      echo "  $name: cleared"
      in_netns "$name" "$CLEAR"
    done
    [ $# -gt 0 ] || rm -f "$STATE"
    ;;
  check)
    [ $# -le 1 ] || usage
    select_targets "${1:-dss-0}"
    from=${names[0]}
    # Expected RTTs come from the last apply; there are none after clear.
    planned=0
    if [ -f "$STATE" ]; then
      # shellcheck disable=SC1090
      . "$STATE"
      load_ranges
      planned=1
    fi
    list="gateway,$GATEWAY,0"
    for n in "${!NET[@]}"; do
      [ "$n" != "$from" ] || continue
      expected=0
      if [ -n "${POOL[$n]:-}" ]; then
        if [ $planned = 1 ]; then
          expected=$(ms "$(rtt_us "$(instance_of "${POOL[$from]}")" "$(instance_of "${POOL[$n]}")")")
        fi
      fi
      list+=" $n,${NET[$n]},$expected"
    done
    list=$(tr ' ' '\n' <<< "$list" | sort -t, -k2,2V | tr '\n' ' ')
    echo "RTT from $from (${POOL[$from]}), average of 5 pings:"
    printf '  %-26s %-15s %9s %9s\n' container address expected measured
    in_netns "$from" "$CHECK" -e "TARGETS=$list"
    ;;
  *)
    usage
    ;;
esac
