// Injected by people_bots.json: who players are (names may repeat), renaming, the rules editor's
// search across every tab, and the bots page (the host's own bots, flags, putting bots on teams).
(() => {
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (test, ms = 3000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (test()) return true;
      await wait(50);
    }
    return false;
  };
  const players = () => [...dp.net.latest.players.values()];
  const rows = (id) => [...document.querySelectorAll(`#${id} li`)].map((li) => li.textContent.replace(/\s+/g, ' ').trim());

  /** A second person called the same as me, from another "browser" (its own secret code). */
  window.__twin = async () => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    window.__twinWs = ws;
    await new Promise((resolve) => (ws.onopen = resolve));
    ws.send(JSON.stringify({ t: 'join', name: dp.myName, guest: true, who: 'a-different-browser-code-0001', tab: 'twin-tab' }));
    const welcome = await new Promise((resolve) => {
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === 'welcome') resolve(m);
      };
    });
    await until(() => players().filter((p) => p.name === dp.myName).length === 2);
    await until(() => document.querySelectorAll('.teamCol .tag.nth').length === 2);
    const mine = players().find((p) => p.id === dp.me.id);
    const twin = players().find((p) => p.id === welcome.id);
    return JSON.stringify({ sameName: twin.name === mine.name, myKey: mine.k, twinKey: twin.k, differ: mine.k !== twin.k,
      numbers: [...document.querySelectorAll('.teamCol .tag.nth')].map((t) => t.textContent) });
  };

  /** The host gives the twin own settings: only the twin plays by them. */
  window.__twinSettings = async () => {
    const twin = players().find((p) => p.name === dp.myName && p.id !== dp.me.id);
    dp.net.send({ t: 'rules', player: twin.k, set: { MAX_HP: 230 } });
    await until(() => dp.rules.players[twin.k]);
    await wait(300);
    const now = players();
    return JSON.stringify({ twinHp: now.find((p) => p.id === twin.id).hp, myHp: now.find((p) => p.id === dp.me.id).hp,
      label: dp.rules.labels[twin.k], myCfgHp: dp.cfg.maxHp });
  };

  /** Rename from the menu's name box. */
  window.__rename = async (name) => {
    const box = $('renameInput');
    box.value = name;
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const ok = await until(() => dp.me?.name === name.trim().slice(0, 32));
    await wait(300);
    return JSON.stringify({ ok, name: dp.me.name, team: dp.me.team, key: dp.me.k, stored: JSON.parse(sessionStorage.getItem('dp.join')).name,
      popup: $('popups').textContent.slice(-40), title: document.title, hudName: $('myName').textContent });
  };

  /** The rules editor's search: every tab at once. */
  window.__search = (q) => {
    const s = $('rulesSearch');
    s.value = q;
    s.dispatchEvent(new Event('input'));
    const nav = [...document.querySelectorAll('#rulesNav button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim());
    const groups = [...document.querySelectorAll('#rulesList h4.subhead')].map((h) => h.textContent);
    return JSON.stringify({ q, rules: document.querySelectorAll('#rulesList .rule').length, groups: [...new Set(groups)].slice(0, 8),
      nav: nav.filter((t) => /\d/.test(t)).slice(0, 8), marked: document.querySelectorAll('#rulesList mark').length,
      on: [...document.querySelectorAll('#rulesNav button.on')].map((b) => b.textContent) });
  };

  /** The bots page: make Alex on BLUE and give it two flags, all through the page's own controls. */
  window.__makeAlex = async () => {
    $('botsBtn').click();
    $('newBotName').value = 'Alex';
    $('newBotTeam').value = '1';
    $('newBotBtn').click();
    await until(() => dp.rules.bots?.roster?.alex);
    await wait(300);
    for (const flag of ['dodge-master', 'berserker']) {
      const pick = [...document.querySelectorAll('#rosterList select')][0];
      pick.value = flag;
      pick.dispatchEvent(new Event('change'));
      await until(() => dp.rules.bots.roster.alex.flags.includes(flag));
      await wait(250);
    }
    const alex = players().find((p) => p.k === 'b:alex');
    return JSON.stringify({ roster: dp.rules.bots.roster.alex, lineup: dp.rules.bots.lineup, team: alex?.team, name: alex?.name,
      page: rows('rosterList'), flags: rows('flagList').length });
  };

  /** Alex's own settings page shows what its flags make it play by. */
  window.__alexPage = () => {
    $('botsClose').click();
    document.querySelector('#listBlue button[data-own="b:alex"]').click();
    const ed = dp.editor;
    ed.group = 'bots';
    ed.renderNav();
    ed.renderList();
    const v = (k) => document.querySelector(`#rulesList .rule[data-key="${k}"] .value`)?.textContent;
    return JSON.stringify({ heading: $('rulesHeading').textContent, react: v('BOT_NORMAL_REACT'), power: v('BOT_NORMAL_POWER_MIN'),
      stance: v('BOT_NORMAL_STANCE'), lobbyTags: [...document.querySelectorAll('#listBlue .tag.flag')].map((t) => t.textContent),
      fileBox: !$('rulesFileBox').hidden });
  };

  /** A flag's own page: the behaviour once, whatever the skill; an edit applied reaches Alex. */
  window.__editFlag = async () => {
    $('rulesClose').click();
    dp.editor.openFlag('berserker', 'Berserker');
    const ed = dp.editor;
    ed.group = 'bots';
    ed.renderNav();
    ed.renderList();
    const heads = [...document.querySelectorAll('#rulesList h4.subhead')].map((h) => h.textContent);
    const shown = [...document.querySelectorAll('#rulesList .rule')].map((r) => r.dataset.key);
    ed.setDraft('BOT_NORMAL_POWER_MIN', 0.8);
    ed.setDraft('BOT_NORMAL_POWER_MAX', 0.9);
    $('rulesApply').click();
    await until(() => dp.rules.bots.flags.berserker.values.BOT_NORMAL_POWER_MAX === 0.9);
    return JSON.stringify({ heading: $('rulesHeading').textContent, heads, easyOrHard: shown.filter((k) => /^BOT_(EASY|HARD)_/.test(k)).length,
      values: dp.rules.bots.flags.berserker.values, mode: $('rulesMode').textContent.slice(0, 80) });
  };

  /** Moving, taking off and bringing back a bot from the lobby's team lists. */
  window.__shuffleAlex = async () => {
    $('rulesClose').click();
    const team = () => players().find((p) => p.k === 'b:alex')?.team;
    document.querySelector('#listBlue button[data-bot="alex"][data-do="move"]').click();
    await until(() => team() === 0);
    const moved = team();
    document.querySelector('#listRed button[data-bot="alex"][data-do="remove"]').click();
    await until(() => team() === undefined);
    const off = team();
    await wait(200);
    const choices = [...$('addBlue').options].map((o) => o.textContent);
    $('addBlue').value = 'alex';
    $('addBlue').dispatchEvent(new Event('change'));
    await until(() => team() === 1);
    return JSON.stringify({ moved, off: off === undefined ? 'off' : off, choices, back: team(), lineup: dp.rules.bots.lineup });
  };
})();
