// reborn.js — 転生モーダル、殿堂、遊び方
import { computeScore, lifeSummary } from '../../engine/score.js';
import { SKILLS } from '../../engine/skills.js';
import { drawSparkline, drawRadar } from '../charts.js';
import { $, $$, esc, fmt, setHTML, setText, show } from './dom.js';

const CAUSE = { natural: '天寿', illness: '病', bankrupt: '破産', voluntary: '自主転生' };

export function init(app) {
  $('#reborn-body').addEventListener('click', (e) => {
    const b = e.target.closest('#brag-btn');
    if (!b) return;
    app.ui.bragRevealed = Math.min(app.state.brag.failures.length, app.ui.bragRevealed + 1);
    renderBrag(app);
  });
  $('#reborn-body').addEventListener('change', (e) => {
    if (e.target.name === 'brag-skill') app.ui.bragSkill = e.target.value;
  });
  $('#reborn-foot').addEventListener('click', (e) => {
    if (e.target.closest('#reborn-go')) app.reincarnate(app.ui.bragSkill);
    else if (e.target.closest('#reborn-hall')) openHall(app);
  });
  $('#help-prev').addEventListener('click', () => { app.ui.helpSlide = Math.max(0, app.ui.helpSlide - 1); renderHelp(app); });
  $('#help-next').addEventListener('click', () => { app.ui.helpSlide = Math.min(SLIDES.length - 1, app.ui.helpSlide + 1); renderHelp(app); });
  $('#help-done').addEventListener('click', () => app.closeModal('m-help'));
}

/* ───────── 転生 ───────── */

export function openReborn(app) {
  app.ui.bragRevealed = 0;
  app.ui.bragSkill = 'guts';
  renderReborn(app);
  app.openModal('m-reborn', '#brag-btn');
  drawRebornCanvases(app);
}

export function drawRebornCanvases(app) {
  if ($('#m-reborn').hidden) return;
  const spark = $('#cv-spark');
  const radar = $('#cv-radar');
  if (spark) drawSparkline(spark, app.state.history.map((h) => h.netWorth), { baseline: 0, bg: null });
  if (radar) drawRadar(radar, computeScore(app.state), { bg: null });
}

function renderReborn(app) {
  const { state } = app;
  const score = computeScore(state);
  const sum = lifeSummary(state, score);
  const cause = CAUSE[state.life.deathCause] || '転生';
  setText($('#m-reborn-title'), `第${state.life.n}生、享年${state.life.age}歳`);
  setText($('#reborn-cause'), `死因: ${cause}`);
  const bonus = (state.brag.points || 0) * 30;
  setHTML($('#reborn-body'), `
    <div class="reborn-grid">
      <div>
        <h3 class="eyebrow">純資産の推移</h3>
        <canvas id="cv-spark" role="img" aria-label="純資産のスパークライン"></canvas>
        <dl class="kv" style="margin-top:8px">
          <dt>生きた年数</dt><dd class="num">${sum.years} 年</dd>
          <dt>最終純資産</dt><dd class="num">${esc(fmt(sum.netWorth))}</dd>
          <dt>最高純資産</dt><dd class="num">${esc(fmt(sum.peakNetWorth))}</dd>
          <dt>買い付け</dt><dd class="num">${sum.offersMade} 件（通過 ${sum.offersAccepted}）</dd>
          <dt>アラモの時</dt><dd class="num">${sum.alamoCount} 回</dd>
          <dt>読んだ本</dt><dd class="num">${sum.booksRead} 冊</dd>
          <dt>出来事</dt><dd class="num">${sum.events} 件</dd>
        </dl>
      </div>
      <div>
        <h3 class="eyebrow">スコア</h3>
        <canvas id="cv-radar" role="img" aria-label="富・楽・学・縁のレーダー"></canvas>
        <div class="score-row">
          <div><div class="l">富</div><div class="v num">${score.wealth}</div></div>
          <div><div class="l">楽</div><div class="v num">${score.fun}</div></div>
          <div><div class="l">学</div><div class="v num">${score.learning}</div></div>
          <div><div class="l">縁</div><div class="v num">${score.network}</div></div>
          <div><div class="l">自慢</div><div class="v num">${score.brag}</div></div>
          <div class="tot"><div class="l">総合</div><div class="v num gold">${score.total}</div></div>
        </div>
      </div>
    </div>
    <p class="epitaph">${esc(state.life.epitaph || '人生はゲームだ。また賭けろ。')}</p>
    <div style="margin-top:12px">
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <button class="btn gold" id="brag-btn">失敗を自慢する</button>
        <span class="brag-count num" id="brag-count"></span>
        <span class="hint">失敗 ${state.brag.failures.length} 件 · 自慢ポイント 合計 ${state.brag.points || 0}</span>
      </div>
      <ol class="failures" id="brag-list"></ol>
    </div>
    <div style="margin-top:14px">
      <h3 class="eyebrow">自慢ポイント × 30 XP を注ぐ</h3>
      <div class="radios" style="margin-top:6px">
        ${SKILLS.map((s) => `<label><input type="radio" name="brag-skill" value="${esc(s.id)}" ${s.id === 'guts' ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}
      </div>
      <p class="hint" style="margin-top:4px">この人生の XP はそのまま持ち越し。自慢ポイント ${state.brag.points || 0} × 30 = <span class="num">${bonus}</span> XP を選んだスキルに足す。</p>
    </div>`);
  setHTML($('#reborn-foot'), `
    <button class="btn" id="reborn-hall">殿堂を見る</button>
    <span class="spacer"></span>
    <button class="btn primary" id="reborn-go">転生する ▶</button>`);
  renderBrag(app);
}

function renderBrag(app) {
  const fails = app.state.brag.failures || [];
  const n = app.ui.bragRevealed;
  setText($('#brag-count'), `自慢ポイント ${n}`);
  const btn = $('#brag-btn');
  if (btn) btn.disabled = n >= fails.length;
  setHTML($('#brag-list'), fails.length
    ? fails.slice(0, n).map((f) => `<li>${esc(f)}</li>`).join('')
    : '<li class="list-empty">失敗がない。それは、何も賭けなかったということだ。</li>');
}

/* ───────── 殿堂 ───────── */

export function openHall(app) {
  const m = app.meta;
  const rows = Array.isArray(m.hallOfFame) ? m.hallOfFame : [];
  setHTML($('#hall-body'), `
    <div class="hall-stats">
      <div><span class="eyebrow">最高スコア</span><span class="v num gold">${Math.round(m.bestScore || 0)}</span></div>
      <div><span class="eyebrow">人生</span><span class="v num">${m.lives || 0}</span></div>
      <div><span class="eyebrow">自慢ポイント</span><span class="v num">${m.bragPoints || 0}</span></div>
      <div><span class="eyebrow">持ち越し XP</span><span class="v num" style="font-size:13px">${SKILLS.map((s) => `${s.name} ${Math.round(m.skills?.[s.id] || 0)}`).join(' · ')}</span></div>
    </div>
    ${rows.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>#</th><th>人生</th><th>享年</th><th>スコア</th><th>純資産</th><th>死因</th><th>遺言</th></tr></thead>
      <tbody>${rows.map((r, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td class="num">第${r.life}生</td>
          <td class="num">${r.age}歳</td>
          <td class="num gold">${Math.round(r.score)}</td>
          <td class="num">${esc(fmt(r.netWorth))}</td>
          <td>${esc(CAUSE[r.cause] || r.cause || '—')}</td>
          <td class="ep">${esc(r.epitaph || '')}</td>
        </tr>`).join('')}</tbody>
    </table></div>` : '<p class="list-empty">まだ誰もいない。最初の人生を生き切れ。</p>'}`);
  app.openModal('m-hall');
}

/* ───────── 遊び方 ───────── */

const SLIDES = [
  {
    title: 'ルール',
    html: `
      <ul>
        <li>1 ターン = 1 年。22 歳、現金 300 万で始まる。死ぬか、破産するか、自分で転生を選ぶまで続く。</li>
        <li>毎年「采配」を決める: 時間の配分（読書・偵察・人脈・遊ぶ・副業）、貯蓄率、株式比率、偵察先、買い付け、本。</li>
        <li>市場は本物のモデル（ファンダ派とチャート派の綱引き）。バブルと暴落は内側から起きる。</li>
        <li>街は 6×6。偵察すると推定誤差が縮み、現地の噂が入る。売主の本音は見えないが、15% は投げ売りだ。</li>
        <li>物件はキャッシュフローの符号で「資産」か「負債」。負債はバフェットに叱られる。</li>
        <li>死んでもスキル XP は次の人生へ。失敗は自慢ポイントになり、転生時のボーナス XP に変わる。</li>
      </ul>`,
  },
  {
    title: '価値観 → ルール',
    html: `
      <div class="table-wrap"><table class="table">
        <thead><tr><th>価値観</th><th>ゲームルール</th></tr></thead>
        <tbody>
          <tr><td>死は終わりではない</td><td>死亡・破産・自主転生でスキル XP を持ち越して転生。恐怖で選択を縮める理由を消す</td></tr>
          <tr><td>アラモを忘れるな</td><td>暴落年は「アラモの時」。エネルギー +40、売主の投げ売り率が 3 倍</td></tr>
          <tr><td>成功は誇る、失敗は自慢する</td><td>却下された買い付け、損失、破産は自慢ポイント → 転生時 XP ボーナス</td></tr>
          <tr><td>資産と負債を厳密に区別</td><td>各物件にキャッシュフロー符号で「資産」「負債」タグ。負債はバフェットが毎年叱る</td></tr>
          <tr><td>とにかく買い付けを出す。半額でもいい</td><td>売主の本音は混合分布（15% は投げ売り）。半額でも通ることがある。却下でも学び +2、自慢 +1</td></tr>
          <tr><td>無知に気づいたら自己教育</td><td>クオンツスキルが上がると Kelly、モンテカルロ扇形図、市場生態系が「見える」ようになる</td></tr>
        </tbody>
      </table></div>`,
  },
  {
    title: '操作',
    html: `
      <ul>
        <li><kbd>Enter</kbd> で年を進める（モーダルが開いていないとき）。<kbd>Esc</kbd> でモーダルを閉じる。</li>
        <li>左の「今年の采配」でスライダーを動かす。時間は合計 100 に自動で釣り合う。</li>
        <li>街のタイルを押すと地区の詳細。「偵察先に追加」は 3 つまで。売出しの「買い付け」で提示率と LTV を決める。</li>
        <li>下のバー: 「街と買い付け」で今年の売出し一覧、「本棚」で本を選ぶ（1 冊に読書 10）、「殿堂」で過去の人生。</li>
        <li>FIRE は不労所得が生活費を超えたときだけ押せる。「転生する」はいつでも。胆力 +100。</li>
        <li>賢人会議は毎年 3 人が一言。Claude がいる環境では「深く聞く」で同じ人格が状態を読んで答える。</li>
      </ul>`,
  },
];

export function openHelp(app) {
  app.ui.helpSlide = 0;
  renderHelp(app);
  app.openModal('m-help', '#help-next');
}

function renderHelp(app) {
  const i = app.ui.helpSlide;
  const s = SLIDES[i];
  setHTML($('#help-body'), `<div class="slide"><h3>${i + 1} / ${SLIDES.length} — ${esc(s.title)}</h3>${s.html}</div>`);
  setHTML($('#help-dots'), SLIDES.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join(''));
  $('#help-prev').disabled = i === 0;
  show($('#help-next'), i < SLIDES.length - 1);
  show($('#help-done'), i === SLIDES.length - 1);
}
