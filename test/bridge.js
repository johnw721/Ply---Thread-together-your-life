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
  // stamp: per-record updatedAt, maintained by save() rather than by call sites
  'EPOCH','stampOf','STAMP_SKIP','recSig','eachRec','shadowReset','stampUpdated',
  'addGoal','deleteGoal','addEvent','removeEvent','skipOccurrence',
  'occursOn','occurrenceOf','masterEvent','eventsOn','CAL',
  // google provider
  'G_SCOPE','G_BACK_DAYS','G_FWD_DAYS','G_SYNCKEY','G_MAXPAGES',
  'gmeta','gqueue','gCal','gOn','gClientId','gOriginOK','gCursor','gCursorSet',
  'gLoadGIS','gRequestToken','gToken','gConnect','gDisconnect','gapi',
  'gISO','gReadTime','gToRow','gFromRow','gWinFrom','gWinTo','inWindow','gDead','gForeign',
  'gEnqueue','gPending','gFlush','gLease','gSync','gApply','gCancel','gDrop','gAdopt','gMerge',
  'gStart','gStop','gChips','gAct','gPrefsHTML','gReadPrefs',
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
  'renderSignals','scrollStripToNow','sigResolverHTML','sigFixAct','itemCard','dayStripHTML','calPos','calMinAt',
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
  // pwa: the service-worker guard, the install hint, and local notifications
  'BUILD','SW_URL','SW_WHY','swBlockedBecause','registerSW',
  'standalone','iosWeb','installHint','renderInstallBar','doInstall','plyGoTo','installPrefsHTML',
  'NOTIF_LEAD_MIN','NOTIF_HARD_H','NOTIF_WINDOW_MIN','NOTIF_TICK_MS','NOTIF_KEEP_DAYS',
  'notifSupported','notifPerm','notifWanted','notifOn','notifTrackHard',
  'notifSentList','notifAlreadySent','notifMark','notifPlan','notifShow','notifTick',
  'notifStart','notifStop','notifEnable','notifDisable','notifPrefsHTML',
  // footprints: the hidden cost of a step — time, prerequisites and money
  'TEMPLATES','TMPL_FIELDS','TMPL_GATE','fpMeta','LEARN_AFTER',
  'tmplList','tmplGet','tmplBuiltin','tmplEdited','tmplSet','tmplReset','tmplHide','tmplShow','tmplAdd',
  'matchTemplate','blankFootprint','normCost','normPrereq','normFootprint','fp','hasFootprint',
  'footLead','footLag','footWidth','slotDur','costTotal','stepCost','ensureFootprint','applyTemplate',
  'catByName','catNameOf','prereqDueKey','duePrereqs','prereqById','stepOfEvent','committedWeek',
  'startActual','stopActual','clearActual','actualMins','timing','median','recordSample',
  'tmplGates','clearTmplGate','queueTmplGate','proposeFromDuration','acceptTmplGate','declineTmplGate',
  'MONEY_TARGET','stepById','carryFootprint','togglePrereq','applyFootprint','sigLabel',
  'committedThisWeek','catSegStyle','footRowHTML','tmplPrefsHTML','parsePrereqSpec','parseCostSpec',
  // reschedule: why each anchor happened, and what the pattern of pushes is evidence of
  'ANCHOR_SOURCES','CHURN_SOURCES','CHURN_AT','churnAt',
  'rescheduleHistory','rescheduleLifetime','blankReschedule','bumpReschedule','noteReschedule',
  'rescheduleSummaryFromLog','recomputeAllReschedule','rescheduleLine',
  'DRIFT_MIN_DAYS','DRIFT_SD_FACTOR','driftStats','rescheduleDrift',
  'DRIFT_CADENCE_TYPES','GOAL_GATE_FIELDS','proposeFromDrift','avgDelta','driftPhrase',
  // seed
  'seed'
];

/* Reassigned at runtime — must be read through a getter or the test sees a stale object. */
export const BRIDGE_ACCESSORS = [
  'DB','PASS','MEMONLY','EXTERNAL','UNDO','REDO','PENDING',
  'GTOK','GSTATE','GERR','GIS','GTIMER','GDONE',
  'CK','CKROW','SIGOPEN','SIGALL','SIGFIX','ARMED','GEROW','RETURN_FOCUS','swallowClick','lastZoomIdx',
  'SWREG','SWSTATE','INSTALL_EVT','NOTIF_TIMER','SHADOW'
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
