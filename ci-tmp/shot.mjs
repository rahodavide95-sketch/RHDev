// Screenshot del sito pubblicato (mappa e meteo) per capire cosa vede chi lo apre.
import { chromium } from 'playwright-core';
const OUT = 'ci-out';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const report = {};
for (const [name, url] of [['finlandia', 'https://rahodavide95-sketch.github.io/RHDev/finlandia/'], ['londra', 'https://rahodavide95-sketch.github.io/RHDev/londra/']]) {
  for (const [vp, w, h] of [['desk', 1280, 900], ['mob', 390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const logs = [];
    page.on('console', m => logs.push(m.type() + ': ' + m.text().slice(0, 300)));
    page.on('pageerror', e => logs.push('pageerror: ' + e.message));
    page.on('requestfailed', r => logs.push('reqfail: ' + r.url().slice(0, 120) + ' ' + (r.failure() || {}).errorText));
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(8000);
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; const el = document.getElementById('mappa'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 60); });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${OUT}/shot-${name}-${vp}-map.png` });
    const info = await page.evaluate(() => {
      const m = document.getElementById('map'), r = m ? m.getBoundingClientRect() : null;
      return {
        L: typeof L, mapW: r && r.width, mapH: r && r.height,
        tiles: document.querySelectorAll('.leaflet-tile').length,
        tilesLoaded: document.querySelectorAll('.leaflet-tile-loaded').length,
        markers: document.querySelectorAll('.leaflet-marker-icon').length,
        fallback: (document.getElementById('map-fallback') || {}).style ? getComputedStyle(document.getElementById('map-fallback')).display : null,
        hist: ((document.querySelector('#wx-hist tbody') || {}).textContent || '').slice(0, 300),
        kp: ((document.getElementById('kp-lbl') || {}).textContent || '').slice(0, 120),
        wxNow: ((document.getElementById('wx-rov-desc') || document.getElementById('wx-now-desc') || {}).textContent || '').slice(0, 160)
      };
    });
    report[name + '-' + vp] = { info, logs: logs.slice(0, 40) };
    if (name === 'finlandia') {
      for (const id of ['meteo', 'aurora']) {
        await page.evaluate(i => { const el = document.getElementById(i); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 60); }, id);
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `${OUT}/shot-${name}-${vp}-${id}.png` });
      }
    }
    await ctx.close();
  }
}
await browser.close();
import fs from 'fs';
fs.writeFileSync(`${OUT}/shots.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
