// Init skripta za prehod ShieldSquare/Radware izziva na roksal.com (metoda R523).
// Odstrani avtomatizacijske sledi (webdriver, HeadlessChrome v UA/appVersion).
// NAMENOMERNO NE ponareja vtičnikov — preverjanje PluginArray.prototype
// bi ponarejanje zaznalo (dokazano v R523).
(() => {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true })
    const cisti = String(navigator.userAgent).replace(/HeadlessChrome/g, 'Chrome')
    Object.defineProperty(navigator, 'userAgent', { get: () => cisti, configurable: true })
    Object.defineProperty(navigator, 'appVersion', { get: () => cisti.replace(/^Mozilla\//, ''), configurable: true })
  } catch (e) { /* tiho — lastnost lahko manjka */ }
})()
