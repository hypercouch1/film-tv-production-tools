// Run: node tests/weather.test.js  (no network: tests the parts that turn data into text)
const assert = require('assert');
require('../src/weather.js');
const W = globalThis.Weather;

const d = W.describe({ weather_code: 2, temperature_2m_max: 71.6, temperature_2m_min: 57.9, precipitation_probability_max: 10, sunrise: '2026-11-02T06:41', sunset: '2026-11-02T17:58' }, 'F');
assert.strictEqual(d.weather, 'Partly cloudy · High 72° / Low 58°F · 10% chance of rain');
assert.match(d.sunrise, /6:41/);
assert.match(d.sunset, /5:58|17:58/);
assert.strictEqual(W.describe({ weather_code: 95 }, 'C').weather, 'Thunderstorms');
console.log('  ✓ forecast text');

assert.deepStrictEqual(W.placeQueries('Rosie’s Diner, 412 4th St, Austin TX 78701'),
  ['Rosie’s Diner, 412 4th St, Austin TX 78701', '412 4th St, Austin TX 78701', 'Austin TX 78701', 'Austin']);
assert.deepStrictEqual(W.placeQueries('Paris'), ['Paris']);
console.log('  ✓ falls back from a full address to the city');
console.log('weather: all checks passed');
