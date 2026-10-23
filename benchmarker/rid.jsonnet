// NetRID test. Every flight creates an ISA as it starts and deletes it 2 s after it ends, back to back,
// at the spot defined in common.libsonnet. RID subscriptions cover the spot, so every ISA
// write must find and notify all of them. Flight timing and ramp rules follow monitoring's
// configurations/interuss/isas_uncontended.jsonnet; subscriptions follow netrid/isas_images.jsonnet.
// ./run.sh builds this through wrapper.jsonnet; rendered on its own, it is the sticky run.
local common = import 'common.libsonnet';

// The DSS allows each owner at most 10 RID subscriptions per area, and every token from mock-oauth
// has the same owner (sub), so keep this at 10 or fewer.
local num_subscriptions = 8;
local subscription_id(i) = '16b87239-6063-47d4-a2ff-%d05086859f32' % (i - 1);
local subscriptions = std.range(1, num_subscriptions);

local spec = {
  label: 'NetRID',
  description: 'NetRID ISA created as the flight starts, deleted 2 s after it ends',
  timing: 'back to back: the next flight starts as the previous one ends',
  subscriptions_summary: '%d RID subscriptions over the spot, created before the ramp and deleted after' % num_subscriptions,
  stop_summary: 'when throughput falls below 70% of its peak, over 10 flights fail, flights average over 20 s, or a step takes over 30 s to settle',
  apis: ['rid'],
  scopes: [
    'rid.service_provider', // ISAs
    'rid.display_provider', // subscriptions
  ],
  flight_time: {fixed_spacing: '0s'},
  // Back-to-back flights make each user busy, so users come in larger steps.
  users_per_dss_per_step: 3,

  behavior(dss_list):: {
    astm_netrid_behavior: {rid_version: common.rid_version} + common.dss_choice('rid', dss_list) + {
      isa_strategy: {isa_per_flight: {before_flight_start: '0s', after_flight_end: '2s'}},
    },
  },

  ramp_criteria: {
    throughput_stability_criteria: {
      each_user_completed_at_least: {count: 1, operations: common.flights},
    },
    step_completion_criteria: {
      any_of: [
        {sampling_duration_at_least: '30s'},
        {completed_at_least: {count: 100, operations: common.flights}},
        {average_duration_more_than: {duration: '20s', operations: common.flights}},
      ],
      sampling_duration_at_least: '10s',
      completed_at_least: {count: 5, operations: common.flights},
    },
    load_completion_criteria: {
      any_of: [
        {throughput_lower_than_peak: {operations: common.flights, fraction_of_peak: 0.7}},
        {failures_more_than: {count: 10, operations: common.flights}},
        {most_recent_step: {average_duration_more_than: {duration: '20s', operations: common.flights}}},
        {most_recent_step: {throughput_stability_took_longer_than: '30s'}},
      ],
    },
  },

  // Subscription actions go through the first DSS instance (dss-0); the pool shares the data.
  actions: [
    {
      name: 'Create RID subscription %d' % i,
      f3411: {
        create_subscription: {
          subscription: {
            subscription_id: subscription_id(i),
            rid_version: common.rid_version,
            duration: '23h',
            area: common.area,
            min_alt: common.min_alt,
            max_alt: common.max_alt,
          },
          mode: 'GetDeleteCreate',
        },
      },
    } for i in subscriptions
  ] + [
    {
      name: 'Delete RID subscription %d' % i,
      f3411: {
        delete_subscription: {subscription_id: subscription_id(i), mode: 'GetDeleteIfExist'},
      },
    } for i in subscriptions
  ],
  setup: ['Create RID subscription %d' % i for i in subscriptions],
  teardown: ['Delete RID subscription %d' % i for i in subscriptions],

  latency_series: [{
    name: 'rid_latencies',
    type: 'query.astm.f3411.v22a.dss.createIdentificationServiceArea',
    label: 'Create ISA',
    color: 'purple',
  }],
};

{
  spec:: spec,  // used by wrapper.jsonnet
} + common.build(spec)
