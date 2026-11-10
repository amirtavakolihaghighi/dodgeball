// Drives a headless Chrome through a list of steps, via the Chrome DevTools Protocol.
// No dependencies (Node 22+ has a global WebSocket). Used to test the real client end to end.
//
//   node tests/browser/cdp.js <url> <steps.json> [debugPort]
//
// Open the game with ?nolock so it runs without pointer lock (headless Chrome can't lock),
// e.g. http://127.0.0.1:8123/?nolock&mode=catch. Add &lag=150 to simulate a slow network.
// Start the server with --no-browser so tests don't open windows on the desktop.
//
// Steps (run in order; one action per step):
//   {"eval": "js"}                      run JS in the page, print the result (promises are awaited)
//   {"evalFile": "autodefend.js"}       same, with a file next to the steps file
//   {"waitFor": "js condition", "timeout": 8000}   poll until true (prints how long it took)
//   {"wait": 500}                       sleep (ms)
//   {"shot": "out.png"}                 screenshot (path relative to the current directory)
//   {"shot": "part.png", "clip": {"x": 0, "y": 0, "width": 400, "height": 300, "scale": 2}}   part of the page, zoomed
//   {"key": "KeyW"} / {"key": "KeyW", "down": false}        key down / up (KeyboardEvent.code)
//   {"mouse": "down"|"up"|"move", "button": "left"|"right", "x": 640, "y": 360}
//   {"mouse": "move", "at": "js giving {x, y}", "buttons": 1}   at a place the page works out; buttons 1: dragging
// Page console output and exceptions are printed at the end. A step whose result starts with
// "FAIL" (a check that didn't hold, like a locked move that changed) makes the run exit with 1.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [, , url, stepsFile, portArg] = process.argv;
if (!url || !stepsFile) {
  console.log('usage: node cdp.js <url> <steps.json> [debugPort]');
  process.exit(2);
}
const port = Number(portArg || 9333);
// CDP_SIZE=640x360 renders a smaller page: several software-rendered browsers at once
// otherwise max out the CPU and slow the server they're testing.
const [W, H] = (process.env.CDP_SIZE || '1280x720').split('x').map(Number);
const chrome = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = path.join(os.tmpdir(), `dodgeball-chrome-${port}`);
const proc = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`,
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // Wait up to 30 s for Chrome's debug port: on GitHub's Linux machines it sometimes takes over 10 s.
  let page;
  for (let i = 0; i < 150 && !page; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = targets.find((t) => t.type === 'page');
    } catch { /* not up yet */ }
    if (!page) await sleep(200);
  }
  if (!page) throw new Error('headless Chrome did not open its debug port within 30 s');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(`[console.${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('[EXCEPTION] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Log.entryAdded' && !m.params.entry.url?.endsWith('favicon.ico')) logs.push(`[log.${m.params.entry.level}] ${m.params.entry.text}`);
    if (m.method === 'Page.javascriptDialogOpening') {     // a question nobody can answer here (an alert, "Leave site?"): yes, and noted
      logs.push(`[dialog ${m.params.type}] ${m.params.message}`);
      ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
    }
  };
  const send = (method, params = {}) => new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) console.log('eval EXCEPTION:', r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  let failed = 0;
  const print = (v) => {
    if (v === undefined) return;
    const text = typeof v === 'string' ? v : JSON.stringify(v);
    if (text.startsWith('FAIL')) failed++;
    console.log('->', text);
  };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(1500);

  const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
  for (const s of steps) {
    if (s.eval) print(await evaluate(s.eval));
    if (s.evalFile) print(await evaluate(fs.readFileSync(path.join(path.dirname(stepsFile), s.evalFile), 'utf8')));
    if (s.waitFor) {
      const ms = s.timeout || 10000;
      print(await evaluate(`new Promise((res) => { const t0 = performance.now(); (function poll() {
        let ok = false; try { ok = (${s.waitFor}); } catch {}
        if (ok) return res('waited ' + ((performance.now() - t0) / 1000).toFixed(1) + 's for: ' + ${JSON.stringify(s.waitFor)});
        if (performance.now() - t0 > ${ms}) return res('TIMEOUT waiting for: ' + ${JSON.stringify(s.waitFor)});
        setTimeout(poll, 50); })(); })`));
    }
    if (s.wait) await sleep(s.wait);
    if (s.shot) {
      const clip = s.clip ? { clip: { scale: 1, ...s.clip } } : {};     // {x, y, width, height, scale}: a part, zoomed
      const r = await send('Page.captureScreenshot', { format: 'png', ...clip });
      fs.writeFileSync(s.shot, Buffer.from(r.result.data, 'base64'));
      console.log('saved', s.shot);
    }
    if (s.key) await send('Input.dispatchKeyEvent', { type: s.down === false ? 'keyUp' : 'keyDown', code: s.key, key: s.key });
    if (s.mouse) {
      const type = { down: 'mousePressed', up: 'mouseReleased', move: 'mouseMoved' }[s.mouse];
      let { x = 640, y = 360 } = s;
      if (s.at) ({ x, y } = await evaluate(s.at));      // a place the page works out, e.g. a handle on the athlete
      // "buttons": 1 while the left one is held (a drag). Chrome needs the move to name the button
      // too, or a page's pointer capture (an element holding on to the drag) never takes hold
      const buttons = s.buttons ?? (s.mouse === 'down' ? 1 : 0);
      const button = s.button || (s.mouse === 'move' && !(buttons & 1) ? 'none' : 'left');
      await send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: 1 });
    }
  }
  console.log(logs.length ? logs.join('\n') : '(no console output or errors)');
  if (failed) console.log(`${failed} check(s) FAILED`);
  ws.close();
  proc.kill();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  proc.kill();
  process.exit(1);
});
