// Entry point for ./run.sh: picks the test and how it runs, building on the base tests.
//   test               scd | rid | both (every flight does SCD and NetRID)
//   spread             sticky | random | sequential (see build() in common.libsonnet)
//   scd_subscriptions  explicit | implicit, for scd and both (see scd.jsonnet)
//   steps              above 0, also ends each ramp after this many steps
//   details            true records full request and response bodies in the report
local common = import 'common.libsonnet';
local scd = import 'scd.jsonnet';
local rid = import 'rid.jsonnet';

// Every flight does SCD and NetRID. It keeps SCD's flight timing and ramp rules: NetRID's back-to-back
// flights would leave no time to accept and activate op intents.
local both(scd_spec, rid_spec) = {
  label: '%s + %s' % [scd_spec.label, rid_spec.label],
  description: '%s; %s' % [scd_spec.description, rid_spec.description],
  timing: scd_spec.timing,
  subscriptions_summary: '%s; %s' % [scd_spec.subscriptions_summary, rid_spec.subscriptions_summary],
  stop_summary: scd_spec.stop_summary,
  apis: scd_spec.apis + rid_spec.apis,
  scopes: scd_spec.scopes + rid_spec.scopes,
  flight_time: scd_spec.flight_time,
  users_per_dss_per_step: scd_spec.users_per_dss_per_step,
  behavior(dss_list):: scd_spec.behavior(dss_list) + rid_spec.behavior(dss_list),
  ramp_criteria: scd_spec.ramp_criteria,
  actions: scd_spec.actions + rid_spec.actions,
  setup: scd_spec.setup + rid_spec.setup,
  teardown: scd_spec.teardown + rid_spec.teardown,
  latency_series: scd_spec.latency_series + rid_spec.latency_series,
};

function(test='scd', spread='sticky', scd_subscriptions='explicit', steps=0, details=false)
  assert std.member(['scd', 'rid', 'both'], test) : "test must be 'scd', 'rid' or 'both'";
  local spec =
    if test == 'scd' then scd.spec(scd_subscriptions)
    else if test == 'rid' then rid.spec
    else both(scd.spec(scd_subscriptions), rid.spec);
  common.build(spec, spread, steps, details)
