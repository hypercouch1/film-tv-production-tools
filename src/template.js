// Starting a production from another one: the people, places, gear and budget carry over;
// the script, scenes, schedule and anything that happened (reports, takes, expenses) don't.
// Cast, crew and locations keep their ids, so budget lines built from them still match them
// (Budget → Build from production then fills in the new quantities).
(function (root) {
  const PARTS = [
    ['cast', 'Cast (characters and actors)'],
    ['crew', 'Crew'],
    ['locations', 'Locations'],
    ['gear', 'Equipment list (statuses and dates cleared)'],
    ['budget', 'Budget accounts and rates (no actuals or expenses)'],
  ];
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && typeof x.id === 'string') : []);

  // src: the production to copy from; srcGear / srcBudget: its documents (or null);
  // fresh: the new, empty production (Production.blank). parts: { cast, crew, … }.
  // Returns { prod, gear, budget } (gear / budget null when not copied).
  function copy({ src, srcGear, srcBudget, fresh, parts, newGear, newBudget }) {
    const prod = clone(fresh);
    if (parts.cast) prod.characters = list(src.characters).map((c) => ({ id: c.id, name: String(c.name || ''), actor: String(c.actor || ''), contact: String(c.contact || '') }));
    if (parts.crew) prod.crew = list(src.crew).map((k) => ({ id: k.id, role: String(k.role || ''), name: String(k.name || ''), contact: String(k.contact || ''), allDays: !!k.allDays }));
    if (parts.locations) {
      prod.locations = list(src.locations).map((l) => {
        const out = clone(l);
        out.permit = ''; // permits are per shoot
        return out;
      });
    }
    let gear = null;
    if (parts.gear && srcGear) {
      gear = newGear(prod.id);
      gear.items = list(srcGear.items).map((i) => ({
        ...clone(i), status: 'needed', holder: '', pickup: '', due: '', dayIds: [],
      }));
    }
    let budget = null;
    if (parts.budget && srcBudget) {
      budget = newBudget(prod.id);
      budget.currency = srcBudget.currency == null ? budget.currency : srcBudget.currency;
      budget.fringe = srcBudget.fringe == null ? budget.fringe : srcBudget.fringe;
      budget.contingency = srcBudget.contingency == null ? budget.contingency : srcBudget.contingency;
      budget.lines = list(srcBudget.lines).map((l) => ({
        ...clone(l),
        // Quantities that followed the old schedule start again from zero; typed ones stay.
        qty: l.auto ? 0 : l.qty, actual: 0,
      }));
      budget.costs = [];
    }
    return { prod, gear, budget };
  }

  root.Template = { PARTS, copy };
})(typeof window !== 'undefined' ? window : globalThis);
