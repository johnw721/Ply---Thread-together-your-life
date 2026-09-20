import { describe, it, expect, beforeEach } from 'vitest';
import { boot, TARGET } from '../harness.js';

let h, p;
beforeEach(async () => { h = await boot({ seed: false }); p = h.api; });

describe('classifier · nine types [' + TARGET + ']', () => {
  const cases = [
    ['Pass the CKA exam retake',                          'deadline'],
    ['Practice guitar every day',                          'habit'],
    ['Ship Plumbline v1',                                  'milestone'],
    ['Saving up for a car — $9,000',                       'threshold'],
    ['Stay on top of the inbox',                           'maintenance'],
    ['Apply to platform engineering roles',                'pipeline'],
    ['If the house comes through, start the reno fund',    'contingent'],
    ['Should I go deep on Go or stay with Python',         'decision'],
    ['Get a spare key made',                               'task']
  ];
  for (const [phrase, type] of cases){
    it(`reads "${phrase}" as ${type}`, () => {
      expect(p.classify(phrase).type).toBe(type);
    });
  }

  it('falls back by length when no rule fires', () => {
    expect(p.classify('zzz qqq').type).toBe('task');
    expect(p.classify('zzz qqq wibble frobnicate quux blorp garply waldo').type).toBe('milestone');
  });

  it('honours a forced type and skips the decision gate when forced', () => {
    const c = p.classify('Should I switch stacks', { force: 'milestone' });
    expect(c.type).toBe('milestone');
    expect(c.gates.some(g => g.kind === 'decision')).toBe(false);
  });

  it('scores a known project name toward milestone', () => {
    p.DB.meta.projects = ['Plumbline'];
    const c = p.classify('Tidy up Plumbline docs');
    expect(c.project).toBe('Plumbline');
    expect(c.scores.milestone).toBeGreaterThanOrEqual(7);
  });

  it('a project name containing regex metacharacters does not blow up', () => {
    p.DB.meta.projects = ['C++ (rewrite)'];
    expect(() => p.classify('ship the C++ (rewrite)')).not.toThrow();
  });
});

describe('gate queueing — capture never blocks [' + TARGET + ']', () => {
  it('queues a deadline question when no date is present, and not when one is', () => {
    const bare = p.classify('Renew the certification');
    expect(bare.type).toBe('deadline');
    expect(bare.gates.map(g => g.kind)).toContain('deadline');

    const dated = p.classify('Renew the certification by 2027-03-01');
    expect(dated.gates.map(g => g.kind)).not.toContain('deadline');
  });

  it('always queues a trigger question for contingent', () => {
    expect(p.classify('If the offer comes through, book movers').gates.map(g => g.kind))
      .toContain('trigger');
  });

  it('queues the decision fork question', () => {
    expect(p.classify('Should I move to Denver').gates.map(g => g.kind)).toContain('decision');
  });

  it('queues a confirm-type review for the borderline threshold case', () => {
    expect(p.classify('Set aside $200 a month').gates.map(g => g.kind)).toContain('confirm-type');
  });

  it('gates never prevent a goal being built', () => {
    const c = p.classify('Should I move to Denver');
    const g = p.buildGoalFrom('Should I move to Denver', c);
    expect(g.gates.length).toBeGreaterThan(0);
    expect(g.threads.length).toBe(1);
  });
});

describe('date, clock and money extraction [' + TARGET + ']', () => {
  it('reads an ISO date', () => {
    expect(p.parseWhen('exam on 2027-04-09').key).toBe('2027-04-09');
  });
  it('reads a slashed date and rolls a bare past one into next year', () => {
    const y = p.parseKey(p.today()).getFullYear();
    expect(p.parseWhen('due 1/2').key >= p.today()).toBe(true);
    expect(p.parseWhen('due 12/25/' + (y + 1)).key.startsWith(String(y + 1))).toBe(true);
  });
  it('reads a month name with an ordinal suffix', () => {
    expect(p.parseWhen('due mar 3rd').key.slice(5)).toBe('03-03');
  });
  it('reads relative windows', () => {
    expect(p.parseWhen('in 3 days').key).toBe(p.addDays(p.today(), 3));
    expect(p.parseWhen('in 2 weeks').key).toBe(p.addDays(p.today(), 14));
    expect(p.parseWhen('next week').key).toBe(p.addDays(p.today(), 7));
    expect(p.parseWhen('tomorrow').key).toBe(p.addDays(p.today(), 1));
    expect(p.parseWhen('today').key).toBe(p.today());
  });
  it('a named weekday always lands in the future, never on today', () => {
    const k = p.parseWhen('by friday').key;
    expect(k > p.today()).toBe(true);
    expect(p.parseKey(k).getDay()).toBe(5);
  });
  it('returns null when there is no date', () => {
    expect(p.parseWhen('tidy the garage')).toBe(null);
  });
  it('reads a clock time', () => {
    expect(p.parseClock('call at 4pm').min).toBe(16 * 60);
    expect(p.parseClock('call at 9:30am').min).toBe(9 * 60 + 30);
    expect(p.parseClock('call at 12am').min).toBe(0);
    expect(p.parseClock('no time here')).toBe(null);
  });
  it('reads money in several shapes', () => {
    expect(p.parseMoney('save $9,000')).toBe(9000);
    expect(p.parseMoney('save $5k')).toBe(5000);
    expect(p.parseMoney('save 12k')).toBe(12000);
    expect(p.parseMoney('no money')).toBe(null);
  });
  it('a date pushes toward deadline unless the phrase already reads as recurring', () => {
    expect(p.classify('finish the audit by friday').scores.deadline).toBeGreaterThan(0);
    const habit = p.classify('practice guitar every day tomorrow');
    expect(habit.type).toBe('habit');
  });
});

describe('learned corrections [' + TARGET + ']', () => {
  it('a correction is remembered and scores on a similar phrase', () => {
    p.learnType('reconcile the quarterly numbers', 'deadline');
    const s = p.learnedScore('reconcile the quarterly numbers');
    expect(s.deadline).toBeTruthy();
    expect(s.deadline.score).toBeGreaterThan(0);
  });

  it('the contribution is capped at 8 — below the heaviest rule at 9', () => {
    for (let i = 0; i < 20; i++) p.learnType('wrangle the widget inventory', 'habit');
    expect(p.learnedScore('wrangle the widget inventory').habit.score).toBeLessThanOrEqual(8);
  });

  it('cannot overrule an unambiguous phrase', () => {
    for (let i = 0; i < 20; i++) p.learnType('if the sale comes through buy the van', 'habit');
    expect(p.classify('if the sale comes through buy the van').type).toBe('contingent');
  });

  it('same type plus largely the same words reinforces rather than duplicating', () => {
    p.learnType('practice the guitar scales', 'habit');
    p.learnType('practice the guitar scales daily', 'habit');
    const forHabit = p.DB.meta.learned.filter(e => e.type === 'habit');
    expect(forHabit.length).toBe(1);
    expect(forHabit[0].n).toBe(2);
  });

  it('Dice is symmetric: one incidental word does not drag in a long lesson', () => {
    p.learnType('reconcile the quarterly numbers before the board meeting', 'deadline');
    expect(p.learnedScore('the board meeting').deadline).toBeUndefined();
  });

  it('a one-word lesson does not hijack every phrase containing that word', () => {
    p.learnType('guitar', 'habit');
    expect(p.learnedScore('buy a guitar stand for the spare room upstairs').habit).toBeUndefined();
    expect(p.learnedScore('guitar').habit).toBeTruthy();
  });

  it('only a near-identical phrase erodes a conflicting older lesson', () => {
    p.learnType('practice guitar', 'habit');
    p.learnType('guitar', 'milestone');
    expect(p.DB.meta.learned.find(e => e.type === 'habit')).toBeTruthy();

    p.learnType('practice guitar', 'milestone');
    expect(p.DB.meta.learned.find(e => e.type === 'habit')).toBeFalsy();
  });

  it('a near-identical match suppresses the review gate; a loose one still asks', () => {
    p.learnType('set aside $200 a month', 'threshold');
    const tight = p.classify('set aside $200 a month');
    expect(tight.learned).toBe(true);
    expect(tight.gates.map(g => g.kind)).not.toContain('confirm-type');

    const loose = p.classify('set aside money each month for the trip to Lisbon');
    expect(loose.gates.map(g => g.kind)).toContain('confirm-type');
  });

  it('stopwords and short words never become terms', () => {
    expect(p.termsOf('the a to of and it is')).toEqual([]);
    expect(p.termsOf('Ship the WIDGET!')).toEqual(['ship', 'widget']);
  });

  it('learning is capped at 200 entries', () => {
    for (let i = 0; i < 230; i++) p.learnType('lesson' + i + ' distinct phrase ' + i, 'task');
    expect(p.DB.meta.learned.length).toBeLessThanOrEqual(200);
  });

  it('an unknown type is refused', () => {
    p.learnType('some phrase here', 'not-a-type');
    expect((p.DB.meta.learned || []).length).toBe(0);
  });
});

describe('capture builds the goal [' + TARGET + ']', () => {
  it('a dated capture anchors its first step immediately', async () => {
    p.doCapture('finish the audit tomorrow at 2pm');
    await h.settle();
    const g = p.DB.goals[0];
    const s = p.currentStep(g.threads[0]);
    expect(s.eventId).toBeTruthy();
    const ev = p.eventById(s.eventId);
    expect(ev.dateKey).toBe(p.addDays(p.today(), 1));
    expect(ev.start).toBe(14 * 60);
  });

  it('a dated capture with no clock books an all-day slot', async () => {
    p.doCapture('renew the passport by 2027-01-04');
    await h.settle();
    const ev = p.eventById(p.currentStep(p.DB.goals[0].threads[0]).eventId);
    expect(ev.allDay).toBe(true);
  });

  it('a contingent capture stays dormant with nothing scheduled', async () => {
    p.doCapture('if the house comes through start the reno fund');
    await h.settle();
    const g = p.DB.goals[0];
    expect(g.threads[0].status).toBe('dormant');
    expect(g.threads[0].steps.length).toBe(0);
    expect(p.DB.events.length).toBe(0);
  });

  it('money in the phrase becomes the metric target', () => {
    const c = p.classify('saving up for a car — $9,000');
    const g = p.buildGoalFrom('saving up for a car — $9,000', c);
    expect(g.smart.target).toBe(9000);
    expect(g.smart.metricUnit).toBe('$');
  });

  it('a pipeline goal gets the stage list', () => {
    const c = p.classify('apply to platform roles');
    expect(p.buildGoalFrom('apply to platform roles', c).stages).toEqual(p.PIPELINE_STAGES);
  });

  it('the capture hint names the type and marks a learned reading', () => {
    p.captureHint('practice guitar every day');
    expect(h.document.querySelector('#captureHint').textContent).toContain('Habit');
    p.learnType('wrangle the widget inventory', 'maintenance');
    p.captureHint('wrangle the widget inventory');
    expect(h.document.querySelector('#captureHint').innerHTML).toContain('&#9679;'.replace('&#9679;', '●'));
  });
});
