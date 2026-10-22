# Browser tests

End-to-end checks of the real client in headless Chrome (needs Chrome and Node 22+).

```powershell
.venv\Scripts\python server.py --port 8123 --no-browser          # in one terminal
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock" tests\browser\smoke.json
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock&mode=deflect&lag=150" tests\browser\autodefend.json
```

- `smoke.json`: joins, waits for a round, prints the state, saves `smoke.png`. Fails loudly on any page error.
- `autodefend.json` + `autodefend.js`: presses catch/deflect/dodge (`&mode=`) just before every incoming ball for 40 s and reports how many got through and why. Healthy result: nearly every press defended. Expected misses are two balls arriving together (one catch holds one ball) and ricochets bouncing right at your feet.
- `&lag=150` makes the page add 150 ms of network round trip, to check lag compensation.
- To run two players at once, start two `cdp.js` runs with different debug ports (third argument), for example 9401 and 9402.
- Headless Chrome renders in software (~20 fps), so frame stalls cause the odd late press that a real player at 60 fps wouldn't get.
