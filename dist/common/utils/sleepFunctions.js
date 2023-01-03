/**
 * Module for sleep-related utilities.
 */
/**
 * Synchronously sleeps for the given number of milliseconds.
 * @param ms The number of milliseconds to sleep.
 */
export function sleepSync(ms) {
    const start = new Date().getTime(), expire = start + ms;
    while (new Date().getTime() < expire) { } // eslint-disable-line no-empty
    return;
}
/**
 * Asynchronously sleeps for the given number of milliseconds.
 * @param ms The number of milliseconds to sleep.
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=sleepFunctions.js.map