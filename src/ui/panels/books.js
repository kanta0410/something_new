// books.js — 本棚モーダル
import { availableBooks, BOOK_COST } from '../../engine/books.js';
import { MAX_BOOKS } from '../../engine/game.js';
import { SKILLS } from '../../engine/skills.js';
import { $, esc, setHTML, setText } from './dom.js';

const SKILL_NAME = Object.fromEntries(SKILLS.map((s) => [s.id, s.name]));

export function init(app) {
  $('#books-body').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-book]');
    if (!b) return;
    const id = b.dataset.book;
    const list = app.decisions.books;
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else if (canAdd(app)) list.push(id);
    else return;
    app.onDecisionsChanged('books');
    render(app);
  });
}

function canAdd(app) {
  const n = app.decisions.books.length;
  return n < MAX_BOOKS && app.decisions.time.reading >= BOOK_COST * (n + 1);
}

function whyNot(app) {
  const n = app.decisions.books.length;
  if (n >= MAX_BOOKS) return `今年は ${MAX_BOOKS} 冊まで`;
  const need = BOOK_COST * (n + 1);
  if (app.decisions.time.reading < need) return `読書の時間が足りない（${Math.round(app.decisions.time.reading)} < ${need}）`;
  return '';
}

export function open(app) {
  render(app);
  app.openModal('m-books');
}

export function render(app) {
  const { state, decisions } = app;
  const books = availableBooks(state);
  const chosen = new Set(decisions.books);
  const read = new Set(state.flags?.booksRead || []);
  const reason = whyNot(app);
  setText($('#books-hint'), `${decisions.books.length}/${MAX_BOOKS} 冊 · 読書 ${Math.round(decisions.time.reading)}（1 冊 ${BOOK_COST}）`);
  setHTML($('#books-body'), `
    <p class="hint" style="margin-bottom:6px">読むだけなら XP は基礎値。同じ年に買い付けを出すか株を買い増せば ×2。再読は ×0.5。読書 Lv3 で全冊解放。</p>
    ${books.map((b) => {
      const on = chosen.has(b.id);
      const xp = Object.entries(b.xp).map(([k, v]) => `${SKILL_NAME[k] || k} +${v}`).join(' ');
      return `
      <article class="book">
        <div class="ttl">${esc(b.title)}<span class="au">${esc(b.author)}</span>${read.has(b.id) ? ' <span class="tag mine">既読</span>' : ''}</div>
        <div class="desc">${esc(b.desc)}</div>
        <q>${esc(b.quote)}</q>${b.quoteNote ? `<div class="qn">— ${esc(b.quoteNote)}</div>` : ''}
        <div class="tags num">${esc(xp)}</div>
        <div class="act">
          <button class="btn sm ${on ? 'on' : 'gold'}" data-book="${esc(b.id)}" ${!on && reason ? 'disabled' : ''}>${on ? '読む（予定）' : '読む'}</button>
          ${!on && reason ? `<span class="why">${esc(reason)}</span>` : ''}
        </div>
      </article>`;
    }).join('')}`);
}
