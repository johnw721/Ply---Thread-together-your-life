/* The names the test suites drive the app through.
   Both targets expose exactly this list, which is what makes one suite able to
   prove the migrated tree behaves like the monolith. Mutable module-level state
   (DB, CK, SIGFIX, ...) is exposed through accessors rather than by value, since
   undo/import/adopt all *reassign* DB rather than mutating it. */
export const BRIDGE_VALUES = [
  // util
  'esc','el','uid','clamp','dkey','parseKey','today','addDays','daysBetween','startOfWeek',
  'fmtDay','fmtDate','fmtFull','fmtDateY','fmtTime','nowMin','relDays','toast','money','hrs',
  // store
  'SCHEMA','KEY','LEGACY_KEY','blankDB','migrate','load','save','exportJSON','importJSON',
  'checkpoint','commitCheckpoint','restoreSnapshot','adoptExternal','undo','redo','paintUndo',
  'goals','liveGoals','doneGoals','finishGoal','reopenGoal','goalById','threadById','findThread','findStep',
  'eventById','currentStep','lastDoneStep',
  'newGoal','newThread','newStep','newSub','newEvent','logIt','touchThread',
  'addGoal','deleteGoal','addEvent','removeEvent','skipOccurrence',
  'occursOn','occurrenceOf','masterEvent','eventsOn','CAL',
  // budget
  'BUDGET_COLOURS','budget','catColour','budgetState','fundableGoals','catProjection','logContribution',
  'dayBudget','loadState','loadBar','paintBudget','commitBudget','budAct','viewBudget',
  'budgetBarHTML','budgetSummaryHTML',
  // classify
  'TYPE','PIPELINE_STAGES','RULES','MONTHS','DOWS','parseWhen','parseClock','parseMoney',
  'termsOf','overlap','learnType','learnedScore','classify',
  // engine
  'shortName','cadenceOf','buildGoalFrom','firstStepFor',
  'subs','subProgress','sortSubs','addSub','moveItem','toggleSub','floatSub','carrySubs',
  'completeStep','autoNextTitle',
  'activeItems','itemsOn','unscheduledItems','overdueItems',
  'daysQuiet','quietLimit','HUSH_AT','hushed','signals','sigKey','snoozeSignals',
  'openGates','clearGate','lastDowKey','checkinDue','checkinAgenda','followThrough','streak',
  // views
  'QUAD','ZOOMS','SIG_KIND','SIG_MAX','FIXABLE','captureView','restoreView','render','renderBody',
  'renderSignals','sigResolverHTML','sigFixAct','itemCard','dayStripHTML','calPos','calMinAt',
  'CAL_S','CAL_E','viewDay','viewWeek','viewQuarter','viewList','goalState','listHidden',
  'quarterRange','doneCount','partialCount','bestQuadrant','CARDSUBS',
  // check-in
  'CK_MAX','startCheckin','ckSaveProgress','ckNext','ckBack','subjHead','renderCheckin',
  'suggestDay','suggestTime','ckAct',
  // ui / dialogs
  'FOCUSABLE','openModal','closeModal','armConfirm','disarm','repaintArmed','armLabel','openConfirm',
  'newInHTML','newInAct','doCapture','captureHint','wireView','wireDrag',
  'toggleStep','openDefineNext','openEvent','openConvert','openGoal','refreshGoal',
  'ordControls','schedRowHTML','subListHTML','goalEditorHTML','saveGoalFields','uiAct','geAct','openPrefs',
  // seed
  'seed'
];

/* Reassigned at runtime — must be read through a getter or the test sees a stale object. */
export const BRIDGE_ACCESSORS = [
  'DB','PASS','MEMONLY','EXTERNAL','UNDO','REDO','PENDING',
  'CK','CKROW','SIGOPEN','SIGALL','SIGFIX','ARMED','GEROW','RETURN_FOCUS','swallowClick','lastZoomIdx'
];

/* The script text appended to the legacy document. Classic scripts share one global
   lexical environment, so a trailing script can see the monolith's top-level
   const/let bindings even though they never land on `window`. */
export function legacyBridgeSource(){
  const vals = BRIDGE_VALUES.map(n=>`    ${n}: (typeof ${n}!=='undefined') ? ${n} : undefined,`).join('\n');
  const accs = BRIDGE_ACCESSORS.map(n=>
    `    get ${n}(){ return typeof ${n}!=='undefined' ? ${n} : undefined; },\n`+
    `    set ${n}(v){ try{ ${n}=v; }catch(_){} },`).join('\n');
  return `window.__ply = {\n${vals}\n${accs}\n  };`;
}
