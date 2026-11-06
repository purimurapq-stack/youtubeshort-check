// Optional UI integration check: PLAYWRIGHT_MODULE=/absolute/path/to/playwright node tests/browser-check.cjs
// Start the static server first. The YouTube API is replaced with an explicit test double.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'text/javascript', body: `
      window.YT = { Player: class {
        constructor(mount, options) { this.options=options; this.position=0; this.state=-1; mount.innerHTML='<div style="padding:30px">YouTube API test double</div>'; window.testPlayer=this; setTimeout(()=>options.events.onReady({target:this}),0); }
        mute(){} unMute(){} loadVideoById(v){ this.id=v.videoId; this.position=v.startSeconds; this.emit(1); }
        emit(state){this.state=state;this.options.events.onStateChange({data:state,target:this});}
        getCurrentTime(){return this.position;} getDuration(){return 60;} getVideoLoadedFraction(){return .65;}
        stopVideo(){this.stopped=true;} destroy(){this.destroyed=true;}
      }}; window.onYouTubeIframeAPIReady();` }));
    await page.goto('http://127.0.0.1:8000');
    assert.equal(await page.locator('#automatic').isChecked(), true);
    await page.locator('#automatic').uncheck();
    for (const id of ['abcdefghijk', '12345678901']) { await page.locator('#videoUrl').fill('https://youtube.com/shorts/' + id); await page.locator('#addForm button').click(); }
    assert.equal(await page.locator('#videoList li').count(), 2);
    await page.locator('#start').click(); await page.waitForFunction(() => document.querySelector('#state').textContent === 'PLAYING');
    assert.equal(await page.evaluate(() => testPlayer.id), 'abcdefghijk');
    await page.evaluate(() => testPlayer.emit(3)); await page.waitForTimeout(550); await page.evaluate(() => testPlayer.emit(1));
    assert.match(await page.locator('#buffers').textContent(), /1/);
    await page.waitForTimeout(2600); assert.match(await page.locator('#stalls').textContent(), /1/);
    await page.evaluate(() => testPlayer.position=1); await page.waitForTimeout(550);
    await page.locator('#interval').fill('5'); await page.locator('#interval').dispatchEvent('change');
    await page.evaluate(() => testPlayer.emit(0)); await page.waitForFunction(() => window.testPlayer.id === '12345678901');
    assert.equal(await page.evaluate(() => testPlayer.position), 0);
    await page.waitForTimeout(5200); assert.equal(await page.evaluate(() => testPlayer.id), 'abcdefghijk');
    await page.locator('#stop').click(); const rowCount = await page.locator('#logs tr').count();
    assert.equal(await page.evaluate(() => testPlayer.stopped), true);
    await page.waitForTimeout(1100); assert.equal(await page.locator('#logs tr').count(), rowCount);
    const downloaded = page.waitForEvent('download'); await page.locator('#download').click(); const download = await downloaded;
    const fs = require('node:fs'); const contents = fs.readFileSync(await download.path()); assert.deepEqual([...contents.subarray(0,3)], [239,187,191]);
    await page.locator('#videoList button').last().click(); assert.equal(await page.locator('#videoList li').count(), 1);
    await page.reload(); await page.locator('#automatic').uncheck(); assert.equal(await page.locator('#videoList li').count(), 1);
    await page.screenshot({path:'/tmp/shorts-lab-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({path:'/tmp/shorts-lab-mobile.png',fullPage:true});
    // Fictional IDs are used only by this test double, never the production catalogue.
    await page.route('**/auto-videos.js', route => route.fulfill({ contentType: 'text/javascript', body: "export const AUTO_VIDEOS=[{id:'abcdefghijk'},{id:'12345678901'},{id:'ZYXWVUTSRQP'}]; export const CATALOG_STATUS='TEST FIXTURE';" }));
    await page.reload(); assert.equal(await page.locator('#automatic').isChecked(), true);
    await page.locator('#start').click();
    await page.waitForFunction(() => window.testPlayer && document.querySelector('#state').textContent === 'PLAYING');
    const initial = await page.evaluate(() => testPlayer.id);
    await page.evaluate(() => testPlayer.options.events.onError({data:100}));
    await page.waitForFunction(id => testPlayer.id !== id, initial);
    assert.match(await page.locator('#logs').textContent(), /再生エラー/);
    await page.evaluate(() => testPlayer.options.events.onError({data:150}));
    await page.waitForTimeout(100);
    await page.evaluate(() => testPlayer.options.events.onError({data:101}));
    await page.waitForFunction(() => document.querySelector('#stop').disabled);
    assert.match(await page.locator('#logs').textContent(), /再生可能な候補なし/);
    assert.deepEqual(errors, []);
    console.log('PASS: URL registration/deletion/persistence, start, buffering, stall, ended, 5s switching/wrap, reset, stop, CSV BOM, responsive layout, no JS errors (mock YouTube API).');
  } finally { await browser.close(); }
})().catch(e => {console.error(e);process.exitCode=1;});
