/** "Open the app in the station" setting. Plain localStorage, no app imports, so both the router and the station can use it. */

const KEY = "vt_station_start";
let started = false;

export function startInStation(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0"; // on unless switched off
  } catch {
    return false;
  }
}

export function setStartInStation(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable: the setting just does not stick */
  }
}

/** True only for the first landing on the home route after the app starts. */
export const shouldRedirectToStation = (): boolean => !started && startInStation();

/** The first landing has happened (or the station was opened): the home route is the home page from now on. */
export function markStarted() {
  started = true;
}
