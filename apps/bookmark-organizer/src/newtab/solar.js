/**
 * Solar position and sunrise/sunset calculation for Bookmark Organizer
 * Pure local computation with zero external dependencies.
 * Based on the NOAA Solar Position Algorithm (official zenith: 90.833° = 90°50').
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/**
 * Calculates sunrise and sunset for a given latitude, longitude, and date.
 * Returns Date objects for sunrise and sunset on that local solar day,
 * or null if polar day/night.
 *
 * @param {number} lat - Latitude in degrees (-90 to 90)
 * @param {number} lon - Longitude in degrees (-180 to 180)
 * @param {Date} [date=new Date()] - Reference date
 * @returns {{ sunrise: Date | null, sunset: Date | null }}
 */
export function calculateSunTimes(lat, lon, date = new Date()) {
  const year = date.getFullYear();
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const dayOfYear = Math.floor((date.getTime() - startOfYear.getTime()) / 86400000) + 1;

  // Fractional year in radians
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1);

  // Equation of time in minutes
  const eqtime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  // Solar declination in radians
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const zenith = 90.833 * RAD;
  const latRad = lat * RAD;

  const cosHa =
    Math.cos(zenith) / (Math.cos(latRad) * Math.cos(decl)) -
    Math.tan(latRad) * Math.tan(decl);

  if (cosHa > 1) return { sunrise: null, sunset: null }; // Polar night
  if (cosHa < -1) return { sunrise: null, sunset: null }; // Midnight sun

  const ha = Math.acos(cosHa) * DEG; // Hour angle in degrees

  // Solar noon in UTC minutes from 00:00 UTC of reference day
  const solarNoonMinutes = 720 - 4 * lon - eqtime;
  const sunriseMinutes = solarNoonMinutes - 4 * ha;
  const sunsetMinutes = solarNoonMinutes + 4 * ha;

  const midnightUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const sunrise = new Date(midnightUtc + Math.round(sunriseMinutes * 60 * 1000));
  const sunset = new Date(midnightUtc + Math.round(sunsetMinutes * 60 * 1000));

  return { sunrise, sunset };
}

/**
 * Evaluates whether the current moment is between sunrise and sunset
 * and computes the next transition timestamp.
 *
 * @param {number} lat - Latitude in degrees
 * @param {number} lon - Longitude in degrees
 * @param {Date} [now=new Date()] - Current moment
 * @returns {{
 *   resolvedTheme: "light" | "dark",
 *   sunriseDate: Date | null,
 *   sunsetDate: Date | null,
 *   nextTransitionType: "sunrise" | "sunset",
 *   nextTransitionDate: Date,
 *   nextTransitionTimeStr: string
 * }}
 */
export function getAutoThemeStatus(lat, lon, now = new Date()) {
  const todayTimes = calculateSunTimes(lat, lon, now);
  const nowMs = now.getTime();

  // Edge cases: polar night (always dark) or midnight sun (always light)
  if (!todayTimes.sunrise || !todayTimes.sunset) {
    const tomorrow = new Date(nowMs + 86400000);
    return {
      resolvedTheme: !todayTimes.sunrise ? "dark" : "light",
      sunriseDate: todayTimes.sunrise,
      sunsetDate: todayTimes.sunset,
      nextTransitionType: !todayTimes.sunrise ? "sunrise" : "sunset",
      nextTransitionDate: tomorrow,
      nextTransitionTimeStr: "--:--"
    };
  }

  const sunriseMs = todayTimes.sunrise.getTime();
  const sunsetMs = todayTimes.sunset.getTime();

  let resolvedTheme = "dark";
  let nextTransitionType = "sunrise";
  let nextTransitionDate = todayTimes.sunrise;

  if (nowMs >= sunriseMs && nowMs < sunsetMs) {
    // Daytime: use light theme, next transition is sunset today
    resolvedTheme = "light";
    nextTransitionType = "sunset";
    nextTransitionDate = todayTimes.sunset;
  } else if (nowMs < sunriseMs) {
    // Early morning before sunrise: use dark theme, next transition is sunrise today
    resolvedTheme = "dark";
    nextTransitionType = "sunrise";
    nextTransitionDate = todayTimes.sunrise;
  } else {
    // Evening after sunset: use dark theme, next transition is sunrise tomorrow
    resolvedTheme = "dark";
    nextTransitionType = "sunrise";
    const tomorrow = new Date(nowMs + 86400000);
    const tomorrowTimes = calculateSunTimes(lat, lon, tomorrow);
    nextTransitionDate = tomorrowTimes.sunrise || new Date(nowMs + 86400000);
  }

  const hoursStr = String(nextTransitionDate.getHours()).padStart(2, "0");
  const minsStr = String(nextTransitionDate.getMinutes()).padStart(2, "0");
  const nextTransitionTimeStr = `${hoursStr}:${minsStr}`;

  return {
    resolvedTheme,
    sunriseDate: todayTimes.sunrise,
    sunsetDate: todayTimes.sunset,
    nextTransitionType,
    nextTransitionDate,
    nextTransitionTimeStr
  };
}
