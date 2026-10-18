// Weather for a call sheet, from Open-Meteo (free, no key): finds the place, then that
// day's forecast with sunrise and sunset. Only the place name and date are sent.
(function (root) {
  // WMO weather codes → words.
  const CODES = {
    0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers',
    82: 'Heavy showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorms', 96: 'Thunderstorms with hail', 99: 'Thunderstorms with hail',
  };

  const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');

  // daily: one day of Open-Meteo "daily" values; unit: 'F' or 'C'.
  function describe(daily, unit) {
    const parts = [CODES[daily.weather_code] || 'Mixed'];
    if (daily.temperature_2m_max != null) {
      parts.push(`High ${Math.round(daily.temperature_2m_max)}° / Low ${Math.round(daily.temperature_2m_min)}°${unit}`);
    }
    if (daily.precipitation_probability_max != null) parts.push(`${daily.precipitation_probability_max}% chance of rain`);
    return { weather: parts.join(' · '), sunrise: timeOf(daily.sunrise), sunset: timeOf(daily.sunset) };
  }

  // Shorter and shorter versions of an address, ending with just the city, for the place search.
  function placeQueries(place) {
    const parts = String(place).split(',').map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (let i = 0; i < parts.length; i++) out.push(parts.slice(i).join(', '));
    if (parts.length) out.push(parts[parts.length - 1].replace(/\s+[A-Z]{2}(\s+\d{5})?$/, '')); // "Austin TX 78701" -> "Austin"
    return [...new Set(out.filter(Boolean))];
  }

  async function getJson(url) {
    let res;
    try { res = await fetch(url); } catch { throw new Error("Couldn't reach the weather service. Check your internet connection."); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.reason || `Weather service error (${res.status}).`);
    return data;
  }

  async function forecast(place, date, unit = 'F') {
    if (!String(place || '').trim()) throw new Error('Enter a city for the weather (for example "Austin, TX").');
    let found = null;
    for (const q of placeQueries(place)) {
      const geo = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(q)}`);
      if (geo.results && geo.results.length) { found = geo.results[0]; break; }
    }
    if (!found) throw new Error(`Couldn't find "${place}". Try just the city name.`);
    const days = (new Date(date + 'T00:00') - new Date(new Date().toDateString())) / 86400000;
    if (days > 15) throw new Error('Forecasts are only available up to about 16 days ahead. Try again closer to the shoot.');
    if (days < -60) throw new Error('That date is too far in the past for a forecast.');
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${found.latitude}&longitude=${found.longitude}`
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset'
      + `&timezone=auto&start_date=${date}&end_date=${date}&temperature_unit=${unit === 'C' ? 'celsius' : 'fahrenheit'}`;
    const data = await getJson(url);
    const d = data.daily || {};
    const day = Object.fromEntries(Object.keys(d).map((k) => [k, Array.isArray(d[k]) ? d[k][0] : d[k]]));
    if (day.weather_code == null) throw new Error('No forecast for that date.');
    const place2 = [found.name, found.admin1, found.country_code].filter(Boolean).join(', ');
    return { ...describe(day, unit === 'C' ? 'C' : 'F'), place: place2 };
  }

  // US-style locales get Fahrenheit.
  const defaultUnit = () => (/^en-(US|LR|MM)|^(my|lr)-/i.test((root.navigator && navigator.language) || 'en-US') ? 'F' : 'C');

  root.Weather = { forecast, describe, placeQueries, defaultUnit };
})(typeof window !== 'undefined' ? window : globalThis);
