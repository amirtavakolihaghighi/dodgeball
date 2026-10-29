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
//   {"key": "KeyW"} / {"key": "KeyW", "down": false}        key down / up (KeyboardEvent.code)
//   {"mouse": "down"|"up"|"move", "button": "left"|"right", "x": 640, "y": 360}
// Page console output and exceptions are printed at the end.
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
  let targets;
  for (let i = 0; i < 50 && !targets; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    } catch {
      await sleep(200);
    }
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
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
  const print = (v) => v !== undefined && console.log('->', typeof v === 'string' ? v : JSON.stringify(v));

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
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(s.shot, Buffer.from(r.result.data, 'base64'));
      console.log('saved', s.shot);
    }
    if (s.key) await send('Input.dispatchKeyEvent', { type: s.down === false ? 'keyUp' : 'keyDown', code: s.key, key: s.key });
    if (s.mouse) {
      const type = { down: 'mousePressed', up: 'mouseReleased', move: 'mouseMoved' }[s.mouse];
      await send('Input.dispatchMouseEvent', { type, x: s.x ?? 640, y: s.y ?? 360, button: s.button || 'left', clickCount: 1 });
    }
  }
  console.log(logs.length ? logs.join('\n') : '(no console output or errors)');
  ws.close();
  proc.kill();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  proc.kill();
  process.exit(1);
});
