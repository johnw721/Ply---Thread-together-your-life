/* ---------------------------------------------------------------------------
   The nine goal types, and the pipeline stages.

   Pure data with no dependencies of its own, in its own module because the store
   needs it during migrate() and the engine needs it everywhere. Left in the
   engine it would make the store import the engine, and that cycle decides which
   module sees the other's constants as undefined.
--------------------------------------------------------------------------- */
/* Type specs. `gate` = a field that must be explicit; if it's missing the goal is
   still saved immediately and the question is QUEUED into the next check-in —
   capture never blocks. `cadence` = default silence window in days. */
export const TYPE = {
  deadline:   {label:'Deadline',    gate:'deadline', cadence:4,  rel:'sequential', color:'deadline',
               metric:'progress toward a fixed date', hint:'Metric climbs toward a fixed date.'},
  habit:      {label:'Habit',       gate:null,       cadence:3,  rel:'cyclical',   color:'habit',
               metric:'streak / sessions', hint:'No finish line. Next step is always the next session.'},
  milestone:  {label:'Milestone',   gate:null,       cadence:10, rel:'sequential', color:'milestone',
               metric:'features shipped', hint:'Completing a step pulls the next off the backlog.'},
  threshold:  {label:'Threshold',   gate:null,       cadence:14, rel:'cyclical',   color:'threshold',
               metric:'cumulative total', hint:'Next step is this period\u2019s contribution.', review:true},
  maintenance:{label:'Maintenance', gate:null,       cadence:7,  rel:'cyclical',   color:'maintenance',
               metric:'staying in range', hint:'A gap itself surfaces the goal \u2014 not just the check-in.'},
  pipeline:   {label:'Pipeline',    gate:null,       cadence:7,  rel:'parallel',   color:'pipeline',
               metric:'volume + conversion', hint:'Stages: applied \u2192 screen \u2192 interview \u2192 offer.'},
  contingent: {label:'Contingent',  gate:'trigger',  cadence:0,  rel:'sequential', color:'contingent',
               metric:'dormant until trigger', hint:'Silent until the trigger fires. Never nags before then.'},
  decision:   {label:'Decision',    gate:'decision', cadence:14, rel:'sequential', color:'decision',
               metric:'resolved / not', hint:'Next step is research or decide. Resolves once, then closes or converts.'},
  task:       {label:'Task',        gate:null,       cadence:0,  rel:'sequential', color:'milestone',
               metric:null, hint:'No goal wrapper \u2014 just an item in the matrix.'}
};
export const PIPELINE_STAGES = ['sourced','applied','screen','interview','offer'];
