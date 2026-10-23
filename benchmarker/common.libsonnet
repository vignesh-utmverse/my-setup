// Shared parts of the congested-area benchmarks for the local DSS pool (../dss-dev), and build(), which
// turns a test spec (from scd.jsonnet or rid.jsonnet) into a benchmarker
// configuration. DSS instances are http://dss-<i>.test on dss-dev_cluster; tokens come from mock-oauth.
//
// A test spec has:
//   label                   name of the test in titles
//   description, timing,    one-line descriptions for the run summary: what each flight does, flight
//   subscriptions_summary,  spacing, subscriptions, when the ramp ends
//   stop_summary
//   apis                    DSS APIs it uses: 'scd' (ASTM F3548) and/or 'rid' (ASTM F3411)
//   scopes                  auth scopes those calls need
//   flight_time             spacing between one user's flights
//   users_per_dss_per_step  users added per DSS instance at each ramp step
//   behavior(dss_list)      what a user does with its flights, using the DSS instances in dss_list
//   ramp_criteria           when ramp steps and the ramp end
//   actions, setup,         subscription actions, which of them run before the first ramp, and which
//   teardown                when the run ends, even after Ctrl+C or an error
//   latency_series          DSS calls whose latency is charted
{
  dss_instances: ['dss-0', 'dss-1', 'dss-2'],
  rid_version: 'F3411-22a',
  flights: ['workflow.flight_planner.flight'],

  // The congested spot: every flight is here and every subscription covers it.
  spot_description: 'about 2 m x 2 m at lat 34, lng -118, 0-20 m altitude (WGS84)',
  area: {
    lat_min: 34 - 0.00001,
    lng_min: -118 - 0.00001,
    lat_max: 34 + 0.00001,
    lng_max: -118 + 0.00001,
  },
  min_alt: {value: 0, units: 'M', reference: 'W84'},
  max_alt: {value: 3000, units: 'M', reference: 'W84'},
  location: {
    horizontal: {lat: 34, lng: -118},
    vertical: {value: 300, reference: 'W84', units: 'M'},
  },
  shape: {
    origin_horizontal: {lat: 0, lng: 0},
    origin_vertical: {value: 0, reference: 'W84', units: 'M'},
    origin_time: '2026-01-01T00:00:00Z',
    volumes: [
      {
        volume: {
          outline_polygon: {
            vertices: [
              {lat: -0.00001, lng: -0.00001},
              {lat: 0.00001, lng: -0.00001},
              {lat: 0.00001, lng: 0.00001},
              {lat: -0.00001, lng: 0.00001},
            ],
          },
          altitude_lower: {value: 0, reference: 'W84', units: 'M'},
          altitude_upper: {value: 20, reference: 'W84', units: 'M'},
        },
        time_start: '2026-01-01T00:00:00Z',
        time_end: '2026-01-01T00:00:05Z',
      },
    ],
  },

  pool(api, dss):: '%s_%s_pool' % [dss, api],

  pool_resource(api, dss)::
    if api == 'scd' then {
      resource_type: 'resources.astm.f3548.v21.DSSInstancesResource',
      dependencies: {auth_adapter: 'utm_auth'},
      specification: {
        dss_instances: [{participant_id: '%s_scd' % dss, base_url: 'http://%s.test' % dss}],
      },
    } else {
      resource_type: 'resources.astm.f3411.DSSInstancesResource',
      dependencies: {auth_adapter: 'utm_auth'},
      specification: {
        dss_instances: [{
          participant_id: '%s_rid' % dss,
          base_url: 'http://%s.test/rid/v2' % dss,
          rid_version: $.rid_version,
        }],
      },
    },

  // The DSS part of a behaviour: its pools, and a random pick among them when there are several.
  dss_choice(api, dss_list)::
    {dss_pool: [$.pool(api, dss) for dss in dss_list]}
    + (if std.length(dss_list) > 1 then {dss_selection_strategy: 'Random'} else {}),

  spread_descriptions:: {
    sticky: 'sticky: all instances at once; each user sticks to its own DSS',
    random: 'random: all instances at once; every call goes to a random DSS',
    sequential: 'sequential: one instance at a time, a separate ramp for each',
  },

  // spread  sticky:     all instances at once; users rotate between them and each sticks to its own DSS
  //         random:     all instances at once; every call goes to a random DSS
  //         sequential: one instance at a time, a separate ramp for each
  // steps   above 0, also ends each ramp after this many steps
  // details true records full request and response bodies in the report
  // The result also has a hidden `summary`: text describing the run, for ./run.sh to print.
  build(spec, spread='sticky', steps=0, details=false)::
    assert std.member(['sticky', 'random', 'sequential'], spread) : "spread must be 'sticky', 'random' or 'sequential'";
    local dss = $.dss_instances;
    local n = std.length(dss);
    local sequential = spread == 'sequential';
    local label = '%s, %s' % [spec.label, spread];
    // Every spread adds the same number of users per step, so their charts line up.
    local users_per_step = spec.users_per_dss_per_step * n;

    local user(name, dss_list) = {
      name: name,
      flight_planner: {
        flight_generation: {
          independent_time_location_shape: {
            time: spec.flight_time,
            location: {fixed_location: $.location},
            shape: {fixed_volumes: $.shape},
          },
        },
      } + spec.behavior(dss_list),
    };
    local users =
      if spread == 'random' then [user('USS_any_dss', dss)]
      else [user('USS_%s' % d, [d]) for d in dss];

    local ramp(user_types) = {
      // With several types, new users rotate through them: USS_dss-0, USS_dss-1, USS_dss-2, USS_dss-0, ...
      user_types: user_types,
      initial_users: users_per_step,
      additional_users_per_step: users_per_step,
      random_seed: 1234,
    } + spec.ramp_criteria
      + (if steps > 0 then {load_completion_criteria+: {any_of+: [{completed_steps: steps}]}} else {});
    local loads =
      if sequential then [{name: 'Ramp for %s' % d, user_ramp: ramp(['USS_%s' % d])} for d in dss]
      else [{name: 'Ramp for the pool', user_ramp: ramp([u.name for u in users])}];

    // Sequential runs save the report and chart after each instance's ramp, in case a later one fails.
    local intermediate = 'Generate intermediate artifacts';
    local scenario(name, load, setup, teardown) = {
      name: name,
      [if std.length(setup) > 0 then 'setup']: setup,
      load: load,
      [if std.length(teardown) > 0 then 'teardown']: teardown,
      record_query_details: details,
    };
    local scenarios =
      if sequential then [
        scenario('%s: %s' % [dss[i], label], 'Ramp for %s' % dss[i],
                 if i == 0 then spec.setup else [],
                 if i < n - 1 then [intermediate] else [])
        for i in std.range(0, n - 1)
      ] else [scenario('Pool: %s' % label, 'Ramp for the pool', spec.setup, [])];

    local panel_titles =
      if sequential then [dss[i] for i in std.range(0, n - 1)]
      else [std.join(' + ', dss)];
    local subplot(i) = {
      render_expr: '%d < len(report.report.scenarios)' % i,
      evaluation_context: [
        {name: 'scenario_index', value: '%d' % i},
        {name: 'scenario', value: 'report.report.scenarios[scenario_index]'},
        {name: 'scale', value: '[step.load_factor for step in completed_steps(scenario.steps)]'},
        {
          name: 'failures',
          value: '[throughput_of_step(scenario, s, types=["workflow.flight_planner.flight"], outcomes=[False])' +
                 ' for s in completed_step_indices(scenario.steps)]',
        },
        {name: 'usl', value: 'USLFit.from_data(scale, throughputs[scenario_index])'},
      ],
      x_axis: {label: if sequential then 'Simulated USS users' else 'Simulated USS users (all instances)'},
      // The largest value across every scenario, so all panels share one scale, plus headroom so peaks
      // are not drawn on the frame: 5% for throughput and 30% for latency, so the two peaks never land
      // on the same spot (the latency axis is drawn over the throughput one and would hide it).
      // (max() over the per-scenario lists, as in InterUSS's configs, compares the lists element by
      // element and can pick one whose largest value is not the overall largest, clipping other panels.)
      y_axis: {label: 'Throughput\n(Flights/s)', min_value: 0, max_value_expr: 'max([max(t + [0]) for t in throughputs]) * 1.05'},
      y_axes: [{label: 'Latency\n(ms)', min_value: 0, max_value_expr: 'max([max(t + [0]) for t in latencies]) * 1.3'}],
      xy_plots: [
        {
          type: 'Line',
          color: 'lightgray',
          label_expr: 'f"USL: $\\\\gamma$={usl.parameters.scaling_factor:.2g} $\\\\alpha$={usl.parameters.contention_factor:.2g} $\\\\beta$={usl.parameters.coherency_factor:.2g}"',
          x_data_expr: 'scale',
          y_data_expr: 'list(usl.compute_throughput(scale))',
          kwargs: {zorder: -1},
        },
      ] + [
        {
          type: 'Scatter',
          color: series.color,
          label_expr: '"%s"' % series.label,
          x_data_expr: 'scale',
          y_data_expr: '%s[scenario_index]' % series.name,
          y_axis: 1,
          kwargs: {zorder: -0.9},
        } for series in spec.latency_series
      ] + [
        {type: 'Scatter', color: 'green', label_expr: '"Successes"', x_data_expr: 'scale', y_data_expr: 'throughputs[scenario_index]'},
        {type: 'Scatter', color: 'red', label_expr: '"Failures"', x_data_expr: 'scale', y_data_expr: 'failures'},
      ],
      legend: {location: 'upper left', font_size: 'x-small', label_spacing: 0.2, border_padding: 0.2},
    };

    local users_summary =
      if spread == 'random' then '%d at the start, +%d per step; every user uses every DSS' % [users_per_step, users_per_step]
      else if sequential then '%d at the start, +%d per step, on one DSS at a time' % [users_per_step, users_per_step]
      else '%d at the start, +%d per step (%d per DSS)' % [users_per_step, users_per_step, spec.users_per_dss_per_step];

    {
      summary:: std.join('\n', ['  %-14s %s' % line for line in [
        ['each flight', spec.description],
        ['spread', $.spread_descriptions[spread]],
        ['subscriptions', spec.subscriptions_summary],
        ['DSS instances', '%s (http://<name>.test)' % std.join(', ', dss)],
        ['spot', $.spot_description],
        ['flight timing', spec.timing],
        ['users', users_summary],
        ['ramp ends', spec.stop_summary + (if steps > 0 then ', or after %d steps' % steps else '')],
        ['details', if details then 'every request and response recorded in the report' else 'off'],
      ]]),

      resources: {
        resource_declarations: {
          utm_auth: {
            resource_type: 'resources.communications.AuthAdapterResource',
            specification: {
              // Google service account key mounted by docker-compose.yaml.
              auth_spec: 'ServiceAccount(http://mock-oauth/oauth/token,/keys/sa.json)',
              scopes_authorized: spec.scopes,
            },
          },
        } + {
          [$.pool(api, d)]: $.pool_resource(api, d)
          for api in spec.apis
          for d in dss
        },
      },

      actions: spec.actions + (if sequential then [{
        name: intermediate,
        generate_artifacts: {
          subfolder: 'f"intermediate{action_invocation}"',
          defined_artifact_indices: [0, 1],
        },
      }] else []),

      // The engine runs these when the whole run ends, also after Ctrl+C or an error, so an interrupted
      // run does not leave subscriptions behind to skew the next one. A scenario's own teardown would
      // only run after its ramp completes.
      [if std.length(spec.teardown) > 0 then 'teardown_actions']: spec.teardown,

      user_types: users,
      loads: loads,
      scenarios: scenarios,

      artifacts: [
        {raw_report: {name: 'report'}},
        {
          matplotlib_figure: {
            name: 'scalability_curve',
            title: 'Congested area: %s' % label,
            n_subfigure_rows: 1,
            n_subfigure_cols: std.length(panel_titles),
            evaluation_context: [
              {
                name: 'throughputs',
                value: '[[throughput_of_step(scenario, s, types=["workflow.flight_planner.flight"], outcomes=[True])' +
                       '  for s in completed_step_indices(scenario.steps)]' +
                       ' for scenario in report.report.scenarios]',
              },
            ] + [
              {
                name: series.name,
                value: ('[[latency_of_step(scenario, s, types=["%s"], outcomes=[True, False]).total_seconds() * 1000' % series.type) +
                       '  for s in completed_step_indices(scenario.steps)]' +
                       ' for scenario in report.report.scenarios]',
              } for series in spec.latency_series
            ] + [
              {
                // Every latency series together, per scenario, to scale the latency axis.
                name: 'latencies',
                value:
                  if std.length(spec.latency_series) == 1 then spec.latency_series[0].name
                  else '[%s for i in range(len(report.report.scenarios))]'
                       % std.join(' + ', ['%s[i]' % series.name for series in spec.latency_series]),
              },
            ],
            subfigures: [
              {title: panel_titles[i], subplots: [subplot(i)]}
              for i in std.range(0, std.length(panel_titles) - 1)
            ],
          },
        },
      ],
    },
}
