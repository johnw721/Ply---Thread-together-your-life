import { viewBudget } from './budget.js';
import { rev, uiRev } from './signals.js';

/* ---------- the weekly money panel, still built as a string ----------
   Deliberately not converted yet. The panel is the one surface with live
   feedback while typing: paintBudget() repaints the bar and the percentages on
   every keystroke *without* writing to the DB, because the write happens on
   change so that one edit is one undo step. Converting that needs component
   state mirroring the inputs, and there is no suite for the budget yet — the
   money-budget suite was among the ones that could not be recovered. Converting
   it unguarded is exactly what this migration is set up not to do.

   Wrapping the existing markup keeps the current behaviour exactly: Preact only
   touches the subtree when the html string changes, and viewBudget() reads the
   DB rather than the inputs, so the string is identical while someone is typing
   and the caret is never disturbed. */
export function BudgetPanel(){
  rev.value; uiRev.value;
  return <div dangerouslySetInnerHTML={{ __html: viewBudget() }} />;
}
