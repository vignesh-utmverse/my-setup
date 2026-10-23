// SCD test. For every flight, an op intent is created (Accepted) 20 s before the flight starts,
// activated 10 s before, and deleted 1 s after it ends, at the spot defined in common.libsonnet.
// Flight timing, op intent handling and ramp rules follow interuss/dss
// release/tests/benchmarker/congested_area.jsonnet, adapted to benchmarker v0.35.0.
// ./run.sh builds this through wrapper.jsonnet; rendered on its own, it is the sticky run with an
// explicit subscription.
local common = import 'common.libsonnet';

local subscription_id = '3bdb0b88-a522-4286-9499-160e56c953bb';

// subscriptions  explicit: one shared subscription covering the spot, created before the ramp.
//                implicit: the DSS gives each op intent its own. Benchmarker v0.35.0 asks for one on
//                every write, so the DSS creates one when the op intent is created and replaces it
//                when the op intent is activated.
local spec(subscriptions) =
  assert std.member(['explicit', 'implicit'], subscriptions) : "subscriptions must be 'explicit' or 'implicit'";
  local explicit = subscriptions == 'explicit';
  {
    label: 'SCD, %s subscriptions' % subscriptions,
    description: 'SCD op intent created (Accepted) 20 s before the flight, activated 10 s before, deleted 1 s after',
    timing: 'the next flight starts 29-31 s after the previous one ends',
    subscriptions_summary:
      if explicit then 'explicit: 1 shared SCD subscription, created before the ramp, deleted at the end even if interrupted'
      else 'implicit: the DSS gives each op intent its own SCD subscription',
    stop_summary: 'when throughput falls below 70% of its peak',
    apis: ['scd'],
    scopes: ['utm.strategic_coordination'],
    // The next flight starts about 30 s after the previous one ends, leaving time to accept and activate.
    flight_time: {fixed_spacing: '29s', uniform_random_spacing: '2s'},
    users_per_dss_per_step: 1,

    behavior(dss_list):: {
      scd_behavior: common.dss_choice('scd', dss_list) + {
        subscription_strategy:
          if explicit then {single_subscription: {subscription_id: subscription_id}}
          else {implicit_subscription: {}},
        op_intent_ref_creation_strategy: {
          ovn_coordination_group: 'cluster1',
          coordinate_requested_ovns: true,
          retries: 2,
          accept_before_flight_start: '20s',
          activate_before_flight_start: '10s',
          expect_timely_clearance: true,
        },
        op_intent_ref_cleanup_strategy: {after_actual_flight_end: '1s'},
      },
    },

    ramp_criteria: {
      throughput_stability_criteria: {
        each_user_completed_at_least: {count: 1, operations: common.flights},
      },
      throughput_instability_criteria: {
        any_of: [
          {failures_more_than: {count: 30, operations: common.flights}},
          {phase_duration_at_least: '120s'},
          {average_duration_more_than: {duration: '60s', operations: common.flights}},
        ],
      },
      step_completion_criteria: {
        any_of: [
          {sampling_duration_at_least: '90s'},
          {completed_at_least: {count: 100, operations: common.flights}},
        ],
        sampling_duration_at_least: '10s',
        completed_at_least: {count: 5, operations: common.flights},
      },
      load_completion_criteria: {
        any_of: [
          {throughput_lower_than_peak: {operations: common.flights, fraction_of_peak: 0.7}},
        ],
      },
    },

    // Subscription actions go through the first DSS instance (dss-0); the pool shares the data.
    // Deleting the subscription also removes any op intents left under it.
    actions: if explicit then [
      {
        name: 'Create SCD subscription',
        f3548: {
          create_subscription: {
            subscription: {
              subscription_id: subscription_id,
              duration: '23h',
              area: common.area,
              min_alt: common.min_alt,
              max_alt: common.max_alt,
            },
            mode: 'GetDeleteCreate',
          },
        },
      },
      {
        name: 'Delete SCD subscription',
        f3548: {
          delete_subscription: {subscription_id: subscription_id, mode: 'GetDeleteIfExist'},
        },
      },
    ] else [],
    setup: if explicit then ['Create SCD subscription'] else [],
    teardown: if explicit then ['Delete SCD subscription'] else [],

    latency_series: [{
      name: 'scd_latencies',
      type: 'query.astm.f3548.v21.dss.createOperationalIntentReference',
      label: 'Create op intent',
      color: 'orange',
    }],
  };

{
  spec:: spec,  // used by wrapper.jsonnet
} + common.build(spec('explicit'))
