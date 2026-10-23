# DSS Tests

Node.js scripts for exercising a DSS (Discovery and Synchronization Service). Every test runs through
`main.js`, and every setting is a command-line argument.

Requires Node.js 18 or later. There are no dependencies to install.

## Setup

Put the Google service account keys in this folder (they are gitignored):

| Env | Key file |
|-----|----------|
| `prequal`, `qual`, `sim` | `saKey.json` |
| `prod` | `saKeyProd.json` |
| `staging` (local pool in `../dss-dev`) | `saKeyStaging.json` |

## Usage

```sh
node main.js --env <env> --test <test> [options]
node main.js --help                       # global options and the list of tests
node main.js --test injectRid --help      # one test's options and defaults
```

Tokens are minted fresh on every run. Nothing is cached.

For tab completion of envs, tests, options and option choices, add this line to `~/.bashrc`:

```sh
source /home/laddu/my-setup/dss-test/completion.bash
```

### Global options

| Option | Overrides |
|--------|-----------|
| `-e, --env` | `prequal`, `qual`, `sim`, `prod` or `staging` (required) |
| `-t, --test` | Test to run (required) |
| `--dss-url` | DSS base URL |
| `--dss-host` | Token audience for the DSS |
| `--oauth-url` | OAuth server base URL |
| `--key-file` | Service account key file |
| `--uss-url` | USS base URL written into DSS records |

The per-env defaults are in `config.js`. `staging` points at the local pool:
`http://dss-0.test:18000` and mock-oauth on `oauth.test:18100`. The pool's host names resolve to
127.0.0.1 through `/etc/hosts`. To reach another instance, pass both the URL and the audience, for
example `--dss-url http://dss-1.test:18010 --dss-host dss-1.test`. `--target` takes the
audience from the URL's host name, so `--target http://dss-1.test:18010` is enough.

Tests that take `--target` (`injectRid`, `injectScd`, `globalOptions`) default to the env's
`DSS_TARGETS` list when no `--target` is given. In `staging` that list is all three local instances,
so these tests spread across the whole pool. Pass `--target` to use specific instances instead, or
`--dss-url` to use just that one DSS. `--target` values are parsed by `parseTarget()` and `targets()`
in `lib/args.js`.

### Tests

Only the tests marked "all" run outside `staging`; the rest refuse any other env, since they write
into the DSS or load it. A test declares this with `allEnvs: true` in its module; without it, it is
staging only.

| Test | What it does | Envs | Main options |
|------|--------------|------|--------------|
| `getFlightPlans` | Queries operational intents in a box and lists one manager's | all | `--lat`, `--lng`, `--hours`, `--manager` |
| `getOpIntent` | Fetches an intent from the DSS, then from its USS | all | `--id` |
| `deleteOpIntent` | Deletes operational intents | all | `--intent <id>:<ovn>` (repeatable) |
| `globalOptions` | Reads global options, including the SCD lock settings, from one or more DSS instances | all | `--target <url>=<audience>` (repeatable) |
| `injectRid` | Creates thousands of short-lived RID ISAs and RID subscriptions | staging | see below |
| `injectScd` | Creates thousands of short-lived SCD operational intents (flights) and SCD subscriptions | staging | see below |
| `createFlightPlan` | Creates an operational intent with its own subscription | staging | `--vertices`, `--duration-min`, `--state`, `--key` |
| `ussAvailability` | Reads a USS availability status | staging | `--uss` |

`globalLockFetch` is deprecated: it reads `/aux/v1/configuration/scd_lock_mode`, which the DSS does
not have (not in v0.23.0), so it gets a 404. Use `globalOptions`, which reports `scd_global_lock` and
`scd_hash_lock`. It still runs, with a warning, but is no longer listed or tab-completed.

Negative numbers can be passed directly, as in `--lng -122.41`.

## Load injection: injectRid and injectScd

| Test | `--kind` (default `both`) | Records |
|------|---------------------------|---------|
| `injectRid` | `isa`, `sub`, `both` | RID Identification Service Areas and RID subscriptions |
| `injectScd` | `oi`, `sub`, `both` | SCD operational intents (flights) and SCD subscriptions |

Each wave creates `--count` records of each selected kind. Every record is valid for `--window-sec`
seconds (default 60) from the moment its request is sent, so it expires on its own. With `--waves N`,
a new wave starts every `--wave-interval-sec` seconds (default: the window length), which keeps about
`--count` of each kind live at any time. Each kind runs in its own parallel pool, sized by its
`--<kind>-concurrency` option.

```sh
# 1000 ISAs + 1000 RID subscriptions, 1-minute windows (RID v2)
node main.js -e staging -t injectRid --count 1000

# 1000 operational intents + 1000 SCD subscriptions, 1-minute windows
node main.js -e staging -t injectScd --count 1000

# Keep ~2000 flights live for 10 minutes, spread across all three local DSS instances
node main.js -e staging -t injectScd --kind oi --count 2000 --waves 10 --out results.json

# Same, but only against dss-1
node main.js -e staging -t injectScd --kind oi --count 2000 --waves 10 \
  --target http://dss-1.test:18010

# Show the requests that would be sent, without sending anything
node main.js -e staging -t injectScd --count 10 --dry-run
```

At the end of each wave the script prints success, failure and retry counts, p50/p95/p99 latency per
kind, and failures grouped by status and message. It exits with code 1 if any request failed.
`--out` writes every request (ID, version or OVN, target, window, status, latency) to a JSON file.
Injection runs against `staging` only.

Records are laid out on a grid, `--spacing-km` apart (default 3 km), with `--size-m` squares
(default 200 m), so each gets its own S2 cells. 1000 records span about 93 km and 10,000 about
300 km. Keep spacing minus size at 2.2 km or more.

### RID behaviour

- **10 live subscriptions per area per USS.** The DSS returns `429 Too many existing subscriptions in
  this area already` for the 11th live RID subscription in an S2 cell. The grid spacing exists for
  this limit.
- **Subscription writes contend with each other.** Every RID subscription write checks all of the
  USS's subscriptions, so parallel writes conflict in CockroachDB. On the local pool, one at a time
  runs at about 50/s, while 20 at a time drops to about 2/s and hits the DSS's 10 s handler timeout.
  For this reason `--sub-concurrency` defaults to 1, while `--isa-concurrency` defaults to 50.
- `--rid-version 1` switches to the F3411-19 API (`/v1/dss/...`). The default is F3411-22a
  (`/rid/v2/dss/...`).

### SCD behaviour

- SCD subscriptions have no per-area limit and scale with concurrency (about 445/s at 20 on the local
  pool), so `--oi-concurrency` and `--sub-concurrency` both default to 50.
- Each operational intent gets its own implicit subscription unless you pass `--no-implicit-sub`.
  On the local pool, intents take about twice as long with an implicit subscription.
- A new intent must list, in its `key`, the OVNs of the live intents it overlaps. This happens when
  one wave's windows run into the next wave's at the same grid point, or when you re-run at the same
  `--lat`/`--lng` within a window. The script tracks OVNs per grid point. On a `409` it adds the
  OVNs the DSS reports as missing and retries once; these show up as `retried` in the report.
