/**
 * Sun-position-based theme: light theme when sun is up, dark when down.
 * Uses geolocation when available; falls back to 6:00–18:00 local time.
 */

export type Theme = 'light' | 'dark';

const THEME_ATTR = 'data-theme';

/** Default fallback when geolocation unavailable: 6:00–18:00 local. */
const FALLBACK_SUNRISE_HOUR = 6;
const FALLBACK_SUNSET_HOUR = 18;

/** Gantt bar palette – light theme (day). */
export const GANTT_PALETTE_LIGHT = [
  '#003f5c',
  '#2f4b7c',
  '#665191',
  '#a05195',
  '#d45087',
  '#f95d6a',
  '#ff7c43',
  '#ffa600',
];

/** Gantt bar palette – dark theme (night). */
export const GANTT_PALETTE_DARK = [
  '#003f5c',
  '#2f4b7c',
  '#665191',
  '#a05195',
  '#d45087',
  '#f95d6a',
  '#ff7c43',
  '#ffa600',
];

let currentTheme: Theme = 'light';
let sunriseSunset: { sunrise: Date; sunset: Date } | null = null;
let fallbackMode = true;
let checkIntervalId: number | undefined;
const listeners = new Set<(theme: Theme) => void>();

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

function toDeg(r: number): number {
  return (r * 180) / Math.PI;
}

/**
 * Approximate sunrise/sunset for a given date at (lat, lng).
 * Based on standard astronomical formulas (e.g. USNO/Ed Williams).
 */
function getSunriseSunset(date: Date, lat: number, lng: number): { sunrise: Date; sunset: Date } {
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();

  const N =
    Math.floor(275 * (month / 9)) -
    Math.floor((month + 9) / 12) * (1 + Math.floor((year - 4 * Math.floor(year / 4) + 2) / 3)) +
    day -
    30;

  const lngHour = lng / 15;

  const riseT = N + (6 - lngHour) / 24;
  const setT = N + (18 - lngHour) / 24;

  const riseM = 0.9856 * riseT - 3.289;
  const setM = 0.9856 * setT - 3.289;

  const riseL = riseM + 1.916 * Math.sin(toRad(riseM)) + 0.02 * Math.sin(toRad(2 * riseM)) + 282.634;
  const setL = setM + 1.916 * Math.sin(toRad(setM)) + 0.02 * Math.sin(toRad(2 * setM)) + 282.634;

  let riseRA = toDeg(Math.atan(0.91764 * Math.tan(toRad(riseL))));
  let setRA = toDeg(Math.atan(0.91764 * Math.tan(toRad(setL))));
  riseRA = (riseRA + (Math.floor(riseL / 90) * 90 - Math.floor(riseL / 90) * 90 + 360)) % 360;
  setRA = (setRA + (Math.floor(setL / 90) * 90 - Math.floor(setL / 90) * 90 + 360)) % 360;

  const riseSinDec = 0.39782 * Math.sin(toRad(riseL));
  const riseCosDec = Math.cos(Math.asin(riseSinDec));
  const setSinDec = 0.39782 * Math.sin(toRad(setL));
  const setCosDec = Math.cos(Math.asin(setSinDec));

  const riseCosZenith = Math.cos(toRad(90.833)) - riseSinDec * Math.sin(toRad(lat)) - riseCosDec * Math.cos(toRad(lat));
  const setCosZenith = Math.cos(toRad(90.833)) - setSinDec * Math.sin(toRad(lat)) - setCosDec * Math.cos(toRad(lat));

  const riseH = (360 - toDeg(Math.acos(Math.max(-1, Math.min(1, riseCosZenith))))) / 15;
  const setH = toDeg(Math.acos(Math.max(-1, Math.min(1, setCosZenith)))) / 15;

  const riseUT = riseH + riseRA / 15 - (0.06571 * riseT) - 6.622;
  const setUT = setH + setRA / 15 - (0.06571 * setT) - 6.622;

  const lngOffset = lng / 15;
  const riseLocal = (riseUT - lngOffset + 24) % 24;
  const setLocal = (setUT - lngOffset + 24) % 24;

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const sunrise = new Date(startOfDay.getTime() + riseLocal * 60 * 60 * 1000);
  const sunset = new Date(startOfDay.getTime() + setLocal * 60 * 60 * 1000);

  return { sunrise, sunset };
}

function updateSunriseSunsetForDate(date: Date) {
  const lat = (window as Window & { __themeLat?: number }).__themeLat ?? 40;
  const lng = (window as Window & { __themeLng?: number }).__themeLng ?? -74;
  sunriseSunset = getSunriseSunset(date, lat, lng);
}

function computeTheme(): Theme {
  const now = new Date();
  if (fallbackMode) {
    const h = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    return h >= FALLBACK_SUNRISE_HOUR && h < FALLBACK_SUNSET_HOUR ? 'light' : 'dark';
  }
  if (!sunriseSunset) {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    updateSunriseSunsetForDate(today);
  }
  if (!sunriseSunset) return 'light';
  return now >= sunriseSunset.sunrise && now < sunriseSunset.sunset ? 'light' : 'dark';
}

function applyTheme(theme: Theme) {
  if (theme === currentTheme) return;
  currentTheme = theme;
  document.documentElement.setAttribute(THEME_ATTR, theme);
  listeners.forEach((cb) => cb(theme));
}

function tick() {
  const now = new Date();
  if (!fallbackMode && sunriseSunset) {
    if (now < sunriseSunset.sunrise || now >= new Date(sunriseSunset.sunset.getTime() + 24 * 60 * 60 * 1000)) {
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      updateSunriseSunsetForDate(today);
    }
  }
  const next = computeTheme();
  applyTheme(next);
}

function scheduleNextCheck() {
  if (checkIntervalId !== undefined) window.clearInterval(checkIntervalId);
  checkIntervalId = window.setInterval(tick, 60 * 1000) as unknown as number;
}

export function getTheme(): Theme {
  return currentTheme;
}

export function getGanttPaletteForTheme(theme: Theme): readonly string[] {
  return theme === 'light' ? GANTT_PALETTE_LIGHT : GANTT_PALETTE_DARK;
}

export function subscribeToTheme(callback: (theme: Theme) => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function initTheme(): void {
  tick();
  scheduleNextCheck();

  if (!navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      (window as Window & { __themeLat?: number }).__themeLat = pos.coords.latitude;
      (window as Window & { __themeLng?: number }).__themeLng = pos.coords.longitude;
      fallbackMode = false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      updateSunriseSunsetForDate(today);
      applyTheme(computeTheme());
    },
    () => {},
    { enableHighAccuracy: false, timeout: 5000, maximumAge: 24 * 60 * 60 * 1000 },
  );
}
