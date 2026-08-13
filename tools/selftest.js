/* 人生手帳 —— 回歸測試。
 *
 * 為什麼存在：這本手帳掉過一次紀錄。原因不是某一行寫錯，是「改完只靠肉眼看一遍」
 * 這個做法本身撐不住。所以把每次都該檢查的事寫成程式，改完就跑一遍。
 *
 * 怎麼跑：
 *   python3 -m http.server 8765
 *   開 http://localhost:8765/index.html，在主控台貼上這整份檔案。
 *   它會先收好你現有的資料，跑完自動還回去。
 *
 * 規則：任何一項 FAIL 就不准 commit。
 */
(async () => {
  const K = 'life_journal_v1', BK = K + '_auto_backups';
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
  const q = s => document.querySelector(s);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const read = () => JSON.parse(localStorage.getItem(K) || '{}');
  /* 從「外部」寫入 = 模擬另一個視窗、或凍結後被喚醒的另一個實例 */
  const writeOutside = d => { const raw = JSON.stringify(d); localStorage.setItem(K, raw); localStorage.setItem(K + '_checksum', hash(raw)); };
  const dk = n => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const backups = () => { try{ return JSON.parse(localStorage.getItem(BK) || '[]'); }catch(e){ return []; } };

  const R = [];
  const ok = (name, cond, detail) => R.push({name, pass: !!cond, detail: detail || ''});
  const sec = name => R.push({sec: name});
  const tab = async t => { const b = q(`[data-tab="${t}"]`); if (b) b.click(); await wait(320); };
  const addTodo = async title => { const i = q('#qaTodo'); if (!i) return false; i.value = title; q('[data-act="qa-todo"]').click(); await wait(500); return true; };
  const dismissBanner = async () => { const b = q('[data-act="multitab-keep"]'); if (b){ b.click(); await wait(600); } };

  const SAVED = localStorage.getItem(K), SAVED_SIG = localStorage.getItem(K + '_checksum'), SAVED_BK = localStorage.getItem(BK);

  try {
    /* ═══ 資料安全：掉過一次紀錄的就是這一段，任何一項紅了都不准出貨 ═══ */
    sec('資料安全');

    /* 外部寫入後，本頁的普通操作不可以把它蓋掉 */
    {
      const s = read();
      s.reflections = s.reflections || {};
      [1, 2, 3, 5, 8].forEach(n => { s.reflections[dk(n)] = {mood: 3, text: 'selftest-' + n, updatedAt: Date.now()}; });
      writeOutside(s);
      const before = Object.keys(read().reflections).length;
      await tab('todo');
      await addTodo('selftest-觸發存檔');
      const after = Object.keys(read().reflections).length;
      ok('外部寫入的反思不會被本頁存檔洗掉', after >= before, `${before} → ${after}`);
      ok('有衝突時會出聲，不是靜默覆蓋', !!q('#multiTabBar'));
    }

    /* 沒有未存的字時應該安靜跟上 */
    await dismissBanner();
    {
      const s = read();
      s.reflections[dk(13)] = {mood: 4, text: 'selftest-外部新增', updatedAt: Date.now()};
      writeOutside(s);
      const target = Object.keys(read().reflections).length;
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      await wait(700);
      ok('乾淨狀態會自動跟上外部的新紀錄', Object.keys(read().reflections).length === target);
      ok('自動跟上時不打擾使用者', !q('#multiTabBar'));
      await tab('todo');
      await addTodo('selftest-跟上後再存');
      ok('跟上之後的存檔不會回頭洗掉那筆', Object.keys(read().reflections).length === target,
        `${target} vs ${Object.keys(read().reflections).length}`);
    }
    await dismissBanner();

    /* 縮水守衛：紀錄變少一定要留下回頭路 */
    {
      localStorage.setItem(BK, '[]');
      const s = read();
      delete s.reflections[Object.keys(s.reflections)[0]];
      writeOutside(s);
      document.dispatchEvent(new Event('visibilitychange'));
      await wait(600);
      await tab('todo');
      await addTodo('selftest-縮水後存檔');
      ok('紀錄變少時一定會留下復原點', backups().length >= 1, `復原點 ${backups().length} 個`);
    }
    await dismissBanner();

    /* 自動清理只碰待辦 */
    {
      const s = read();
      const r0 = Object.keys(s.reflections).length, g0 = (s.goals || []).length, h0 = (s.habits || []).length;
      for (let i = 0; i < 45; i++) s.tasks.push({id: 'selftest-d' + i, title: '清理 ' + i, bucket: 'today', done: true, doneAt: Date.now() - i * 36e5, area: null, order: 900 + i, note: '', dueDate: null, scheduledDate: null, focus: false});
      s.settings.autoClearDone = 30;
      writeOutside(s);
      document.dispatchEvent(new Event('visibilitychange'));
      await wait(600);
      await tab('todo');
      await addTodo('selftest-觸發清理');
      const a = read();
      ok('已完成待辦會被清到上限', a.tasks.filter(t => t.done).length <= 30, `${a.tasks.filter(t => t.done).length} 筆`);
      ok('清理不會動到反思', Object.keys(a.reflections).length === r0);
      ok('清理不會動到目標', (a.goals || []).length === g0);
      ok('清理不會動到習慣', (a.habits || []).length === h0);
    }
    await dismissBanner();

    /* 存檔前後，主資料與 checksum 必須一致 */
    {
      const raw = localStorage.getItem(K), sig = localStorage.getItem(K + '_checksum');
      ok('checksum 與主資料相符', hash(raw) === sig);
      ok('主資料是合法 JSON', (() => { try{ JSON.parse(raw); return true; }catch(e){ return false; } })());
    }

    /* ═══ 反思：寫入與封存 ═══ */
    sec('反思');
    {
      await tab('reflect');
      if (q('[data-act="ref-edit-today"]')){ q('[data-act="ref-edit-today"]').click(); await wait(400); }
      const before = Object.keys(read().reflections).length;
      const ta = q('#refText');
      ok('反思有輸入框', !!ta);
      if (ta){
        ta.value = 'selftest-今天寫的內容';
        ta.dispatchEvent(new Event('input', {bubbles: true}));
        await wait(700);
        ok('打字會自動存', (read().reflections[dk(0)] || {}).text === 'selftest-今天寫的內容');
        q('[data-act="ref-save"]').click();
        await wait(700);
        ok('封存後今天那篇還在', (read().reflections[dk(0)] || {}).text === 'selftest-今天寫的內容');
        ok('封存不會弄丟過去的紀錄', Object.keys(read().reflections).length >= before, `${before} → ${Object.keys(read().reflections).length}`);
        ok('封存後收合成「今天已記錄」', document.body.innerText.includes('今天已記錄'));
        ok('今天那篇也出現在過去的紀錄裡', document.body.innerText.includes('過去的紀錄'));
      }
    }

    /* ═══ 目標：步驟的增刪與排序 ═══ */
    sec('人生目標');
    {
      await tab('goal');
      const g = read().goals.find(x => !x.done);
      if (!g){ ok('有可測試的目標', false, '沒有未完成的目標'); }
      else {
        const inp = q('#step-' + g.id);
        ok('目標卡有新增步驟的輸入框', !!inp);
        if (inp){
          for (const t of ['selftest-步驟A', 'selftest-步驟B']){
            const i2 = q('#step-' + g.id); i2.value = t;
            [...document.querySelectorAll('[data-act="step-add"]')].find(b => b.dataset.gid === g.id).click();
            await wait(450);
          }
          const steps = () => read().goals.find(x => x.id === g.id).steps.map(s => s.title);
          ok('步驟新增成功', steps().includes('selftest-步驟A') && steps().includes('selftest-步驟B'));
          ok('每個步驟都有拖曳把手', document.querySelectorAll(`[data-step-drag][data-gid="${g.id}"]`).length >= 2);
          const ed = [...document.querySelectorAll('[data-act="step-edit"]')].find(b => b.dataset.gid === g.id);
          ed.click(); await wait(400);
          const sid = q('[data-act="step-del"]').dataset.sid;
          const wasFirst = read().goals.find(x => x.id === g.id).steps.find(s => s.id === sid).title;
          q('#stTitle').value = 'selftest-改過名字';
          q('[data-act="step-save"]').click(); await wait(500);
          ok('步驟可以改名', steps().includes('selftest-改過名字'), wasFirst + ' → selftest-改過名字');
          const n1 = steps().length;
          [...document.querySelectorAll('[data-act="step-edit"]')].find(b => b.dataset.gid === g.id).click();
          await wait(400);
          q('[data-act="step-del"]').click(); await wait(600);
          ok('步驟可以直接刪除（不再問第二次）', steps().length === n1 - 1, `${n1} → ${steps().length}`);
          ok('刪除後編輯卡自動關閉', !q('#sheetRoot .sheet'));
        }
      }
    }

    /* ═══ 版面與樣式 ═══ */
    sec('版面');
    {
      await tab('today');
      const ringSvg = q('.ring b svg');
      if (ringSvg) ok('完成打勾沒有被圓環的旋轉帶歪', getComputedStyle(ringSvg).transform === 'none');
      await tab('reflect');
      const chips = q('.prompt-chips');
      if (chips){
        const cs = [...chips.children].map(c => Math.round(c.getBoundingClientRect().width));
        ok('起頭按鈕等寬（右邊不留參差空白）', new Set(cs).size === 1, cs.join('/'));
        ok('起頭按鈕不用橫向捲動', chips.scrollWidth <= chips.clientWidth + 1);
      }
    }

    /* ═══ 全域 ═══ */
    sec('全域');
    ok('沒有出現錯誤邊界', !document.body.innerText.includes('你的紀錄還在'));
    for (const t of ['today', 'todo', 'habit', 'reflect', 'goal']){
      await tab(t);
      ok(`${t} 分頁畫得出來`, (q('#view') || {}).innerHTML.length > 200);
    }
  } catch (err) {
    R.push({name: '測試本身中斷', pass: false, detail: String(err && err.message || err)});
  }

  /* 把使用者的資料放回去 */
  if (SAVED === null){ localStorage.removeItem(K); localStorage.removeItem(K + '_checksum'); }
  else { localStorage.setItem(K, SAVED); localStorage.setItem(K + '_checksum', SAVED_SIG); }
  if (SAVED_BK === null) localStorage.removeItem(BK); else localStorage.setItem(BK, SAVED_BK);

  const fails = R.filter(r => r.name && !r.pass);
  const lines = R.map(r => r.sec ? `\n── ${r.sec}` : `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '   (' + r.detail + ')' : ''}`);
  const summary = fails.length ? `\n\n>>> ${fails.length} 項失敗，不要 commit` : `\n\n>>> 全部 ${R.filter(r => r.name).length} 項通過`;
  window.__selftest = {results: R, failed: fails.length, report: lines.join('\n') + summary};
  console.log(window.__selftest.report);
  console.log('資料已還原。重新整理一次讓畫面回到你的紀錄。');
  return window.__selftest.report;
})();
