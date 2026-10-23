import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateSunTimes, getAutoThemeStatus } from "../src/newtab/solar.js";

describe("Bookmark Organizer - Solar Sunrise/Sunset Calculation (VIEW-THEME-002)", () => {
  it("calculates plausible sunrise and sunset for Tokyo (moderate latitude)", () => {
    // Tokyo: 35.6762° N, 139.6503° E on 2026-10-24
    const date = new Date(Date.UTC(2026, 9, 24, 0, 0, 0));
    const times = calculateSunTimes(35.6762, 139.6503, date);

    assert.ok(times.sunrise instanceof Date, "sunrise should be a valid Date");
    assert.ok(times.sunset instanceof Date, "sunset should be a valid Date");

    // Tokyo in late October has sunrise around 05:55 JST (20:55 UTC previous day)
    // and sunset around 16:55 JST (07:55 UTC)
    const sunriseUtcHours = times.sunrise.getUTCHours();
    const sunsetUtcHours = times.sunset.getUTCHours();

    // In UTC, sunrise is ~20-21h, sunset is ~07-08h
    assert.ok(sunriseUtcHours === 20 || sunriseUtcHours === 21, `expected sunrise near 20-21 UTC, got ${sunriseUtcHours}`);
    assert.ok(sunsetUtcHours === 7 || sunsetUtcHours === 8, `expected sunset near 07-08 UTC, got ${sunsetUtcHours}`);
  });

  it("calculates plausible sunrise and sunset for London and San Francisco", () => {
    // London: 51.5074° N, -0.1278° W on 2026-06-21 (summer solstice)
    const summerDate = new Date(Date.UTC(2026, 5, 21, 12, 0, 0));
    const londonTimes = calculateSunTimes(51.5074, -0.1278, summerDate);

    assert.ok(londonTimes.sunrise && londonTimes.sunset);
    // In summer in London, sunrise is before 05:00 UTC and sunset is after 20:00 UTC
    assert.ok(londonTimes.sunrise.getUTCHours() <= 5);
    assert.ok(londonTimes.sunset.getUTCHours() >= 20);

    // San Francisco: 37.7749° N, -122.4194° W on 2026-12-21 (winter solstice)
    const winterDate = new Date(Date.UTC(2026, 11, 21, 12, 0, 0));
    const sfTimes = calculateSunTimes(37.7749, -122.4194, winterDate);

    assert.ok(sfTimes.sunrise && sfTimes.sunset);
    // In SF winter, daylight is ~9.5 hours
    const dayLengthHours = (sfTimes.sunset.getTime() - sfTimes.sunrise.getTime()) / (1000 * 3600);
    assert.ok(dayLengthHours >= 9 && dayLengthHours <= 10.5, `expected day length ~9.5h, got ${dayLengthHours}`);
  });

  it("resolves to light theme during daytime and dark theme at night", () => {
    const lat = 35.6762;
    const lon = 139.6503;

    // Fixed test date: 2026-10-24
    const today = new Date(Date.UTC(2026, 9, 24, 0, 0, 0));
    const times = calculateSunTimes(lat, lon, today);

    // 1) Test noon local time: between sunrise and sunset -> should resolve to light
    const noonLocal = new Date(times.sunrise.getTime() + 4 * 3600 * 1000);
    const dayStatus = getAutoThemeStatus(lat, lon, noonLocal);
    assert.equal(dayStatus.resolvedTheme, "light");
    assert.equal(dayStatus.nextTransitionType, "sunset");
    assert.ok(dayStatus.nextTransitionDate.getTime() > noonLocal.getTime());

    // 2) Test deep night: after sunset -> should resolve to dark
    const nightLocal = new Date(times.sunset.getTime() + 4 * 3600 * 1000);
    const nightStatus = getAutoThemeStatus(lat, lon, nightLocal);
    assert.equal(nightStatus.resolvedTheme, "dark");
    assert.equal(nightStatus.nextTransitionType, "sunrise");
    assert.ok(nightStatus.nextTransitionDate.getTime() > nightLocal.getTime());
  });

  it("handles extreme polar latitudes gracefully (midnight sun / polar night)", () => {
    // Tromsø, Norway (69.6492° N) in mid-December has polar night (no sunrise)
    const winterDate = new Date(Date.UTC(2026, 11, 21, 12, 0, 0));
    const polarNight = calculateSunTimes(69.6492, 18.9553, winterDate);

    // In polar night, sunrise/sunset returns null
    assert.equal(polarNight.sunrise, null);
    assert.equal(polarNight.sunset, null);

    // Auto theme status defaults safely to dark during polar night
    const status = getAutoThemeStatus(69.6492, 18.9553, winterDate);
    assert.equal(status.resolvedTheme, "dark");
  });
});
