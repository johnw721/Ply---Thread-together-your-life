import { describe, it, expect } from 'vitest';
import { boot, TARGET } from '../harness.js';

describe('harness smoke [' + TARGET + ']', () => {
  it('boots with demo data and a rendered view', async () => {
    const h = await boot();
    expect(h.api).toBeTruthy();
    expect(typeof h.api.classify).toBe('function');
    expect(h.api.DB.goals.length).toBeGreaterThan(0);
    expect(h.document.querySelector('#view').innerHTML.length).toBeGreaterThan(100);
    h.close();
  });

  it('boots clean when asked', async () => {
    const h = await boot({ seed: false });
    expect(h.api.DB.goals).toEqual([]);
    h.close();
  });

  it('exposes reassigned state through a live accessor', async () => {
    const h = await boot({ seed: false });
    const fresh = h.api.blankDB();
    fresh.goals.push(h.api.newGoal({ title: 'swapped in' }));
    h.api.DB = fresh;
    expect(h.api.DB.goals[0].title).toBe('swapped in');
    h.close();
  });
});
