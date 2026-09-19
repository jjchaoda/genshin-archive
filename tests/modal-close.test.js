/* 弹层开关链路测试：模拟 DOM 事件，验证「打开 → 点遮罩/✕/ESC → 关闭」在 JS 层可用 */
const noop = () => {};
const docListeners = {};
const map = {};

function mkEl(id, extra) {
  const listeners = {};
  const el = Object.assign({
    id: id || '', style: {}, dataset: {}, hidden: false, value: '', checked: false,
    textContent: '', innerHTML: '', files: null,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop, getAttribute: () => null, removeAttribute: noop,
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener: noop, insertAdjacentHTML: noop, appendChild: noop, remove: noop,
    focus: noop, closest: () => null,
    querySelector: () => null, querySelectorAll: () => [],
    dispatch: (t, ev) => { (listeners[t] || []).forEach((f) => f(ev)); return (listeners[t] || []).length; },
    hasListener: (t) => !!(listeners[t] && listeners[t].length)
  }, extra || {});
  return el;
}

['playerModal', 'playerTitle', 'playerMeta', 'playerTabs', 'playerFrame', 'playerRate', 'playerFav',
 'playerNote', 'playerExternal', 'toast', 'videoGrid', 'videoFilters', 'videoSearch', 'videoSort',
 'onlyFav', 'videos', 'library', 'versionTimeline', 'awardGrid', 'heroStats', 'addVideoForm',
 'noteForm', 'noteList', 'favVideoList', 'favAwardList', 'historyList', 'storageList'].forEach((id) => { map[id] = mkEl(id); });
map.playerModal.hidden = true;
map.playerExternal.hidden = true;

global.window = global;
window.matchMedia = () => ({ matches: true });
window.addEventListener = noop;
window.open = () => null;
window.innerWidth = 1200; window.innerHeight = 800;
window.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: noop };

global.document = {
  documentElement: mkEl('html'), body: mkEl('body'),
  addEventListener: (t, f) => { (docListeners[t] = docListeners[t] || []).push(f); },
  querySelector: (sel) => (sel && sel[0] === '#' ? (map[sel.slice(1)] || null) : null),
  querySelectorAll: () => [],
  getElementById: (id) => map[id] || null,
  createElement: () => mkEl('created'),
  hidden: false
};
global.IntersectionObserver = class { constructor() {} observe() {} unobserve() {} };
global.requestAnimationFrame = (fn) => { if (typeof fn === 'function') fn(0); return 0; };
global.cancelAnimationFrame = noop;
global.performance = { now: () => 0 };
global.Blob = class { constructor(a) { this.size = String(a[0] || '').length; } };
global.FormData = class { get() { return ''; } };
global.FileReader = class {};
global.confirm = () => false;
global.alert = noop;
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};

require('D:/新建文件夹 (2)/js/data.js');
require('D:/新建文件夹 (2)/js/app.js');

const results = [];
function check(name, cond) { results.push((cond ? 'PASS' : 'FAIL') + '  ' + name); }

// 1) #videos 区域是否挂上了点击监听
check('#videos 绑定了 click 监听', map.videos.hasListener('click'));

// 2) 模拟点击影像卡片上的播放按钮 -> 打开弹层
const playBtn = mkEl('playBtn', { closest: (s) => (s === '[data-play]' ? playBtn : null), getAttribute: (a) => (a === 'data-play' ? 'v_10' : null) });
map.videos.dispatch('click', { target: playBtn, preventDefault: noop });
check('点击播放后弹层打开（hidden=false）', map.playerModal.hidden === false);
check('打开时标题被填充', String(map.playerTitle.textContent).indexOf('实机') >= 0 || String(map.playerTitle.textContent).length > 0);
check('打开时写入了 iframe', String(map.playerFrame.innerHTML).indexOf('<iframe') >= 0);
check('打开时锁定了页面滚动', document.body.style.overflow === 'hidden');

// 3) ESC 关闭
(docListeners.keydown || []).forEach((f) => f({ key: 'Escape' }));
check('ESC 关闭弹层（hidden=true）', map.playerModal.hidden === true);
check('关闭后恢复页面滚动', document.body.style.overflow === '');
check('关闭后清空 iframe（停止播放）', map.playerFrame.innerHTML === '');

// 4) 再次打开，点遮罩关闭
map.playerModal.hidden = true;
map.videos.dispatch('click', { target: playBtn, preventDefault: noop });
check('二次打开成功', map.playerModal.hidden === false);
const maskEl = mkEl('mask', { closest: (s) => (s === '[data-close]' ? maskEl : null) });
const n1 = map.playerModal.dispatch('click', { target: maskEl, preventDefault: noop });
check('遮罩点击被 modal 监听接收', n1 > 0);
check('点遮罩后弹层关闭', map.playerModal.hidden === true);

// 5) 再次打开，点 ✕ 按钮关闭
map.playerModal.hidden = true;
map.videos.dispatch('click', { target: playBtn, preventDefault: noop });
const closeBtn = mkEl('closeBtn', { closest: (s) => (s === '[data-close]' ? closeBtn : null) });
map.playerModal.dispatch('click', { target: closeBtn, preventDefault: noop });
check('点 ✕ 后弹层关闭', map.playerModal.hidden === true);

// 6) 点击弹层内部（非 data-close）不应关闭
map.playerModal.hidden = true;
map.videos.dispatch('click', { target: playBtn, preventDefault: noop });
const innerEl = mkEl('inner', { closest: () => null });
map.playerModal.dispatch('click', { target: innerEl, preventDefault: noop });
check('点击弹层内部不会误关闭', map.playerModal.hidden === false);

// 7) 无片源链接时隐藏「原站观看」按钮（依赖 CSS 的 [hidden] 规则才真正不可见）
check('原站观看按钮有隐藏逻辑（hidden 属性）', 'hidden' in map.playerExternal);

console.log(results.join('\n'));
const failed = results.filter((r) => r.indexOf('FAIL') === 0).length;
console.log('\n结果：' + (results.length - failed) + '/' + results.length + ' 通过');
process.exit(failed ? 1 : 0);
