/* ==========================================================================
   提瓦特档案 · 原神资料站
   app.js — 渲染、交互与 localStorage 持久化
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     0. 工具函数
     ------------------------------------------------------------------ */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const toastEl = $('#toast');
  let toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    requestAnimationFrame(() => toastEl.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => { toastEl.hidden = true; }, 400);
    }, 2200);
  }

  /* ------------------------------------------------------------------
     1. 本地存储层（刷新 / 重开浏览器都不丢）
     ------------------------------------------------------------------ */
  const STORAGE_KEY = 'gi_archive_v1';

  // 检测 localStorage 是否可用（个别浏览器在 file:// 下会禁用本地存储）
  const memStore = {};
  const STORAGE_OK = (function () {
    try {
      const probe = '__gi_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return true;
    } catch (e) {
      return false;
    }
  })();
  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return memStore[key] || null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { memStore[key] = value; }
  }

  const DEFAULT_STATE = {
    theme: 'dark',
    favorites: { videos: [], awards: [] },   // 收藏的影像 / 奖项 id
    ratings: {},                             // { [videoId]: 1..5 }
    notes: {},                               // { [videoId]: '笔记内容' }
    userNotes: [],                           // [{ id, title, body, ts }]
    reviewed: [],                            // 已回顾的版本号
    history: [],                             // [{ id, title, ts }] 最近观看
    customVideos: [],                        // 用户自行添加的影像
    filters: { videos: 'all', awards: 'all', versionEra: 'all' },
    stats: { visits: 0, firstVisit: null, lastVisit: null }
  };

  function deepMerge(base, patch) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    if (!patch || typeof patch !== 'object') return out;
    Object.keys(patch).forEach((k) => {
      const bv = out[k], pv = patch[k];
      if (Array.isArray(bv) || Array.isArray(pv)) out[k] = Array.isArray(pv) ? pv.slice() : bv;
      else if (bv && pv && typeof bv === 'object' && typeof pv === 'object') out[k] = deepMerge(bv, pv);
      else if (pv !== undefined && pv !== null) out[k] = pv;
    });
    return out;
  }

  let state = loadState();
  let saveQueued = false;

  function loadState() {
    try {
      const raw = storageGet(STORAGE_KEY);
      if (!raw) return deepMerge(DEFAULT_STATE, {});
      return deepMerge(DEFAULT_STATE, JSON.parse(raw));
    } catch (e) {
      console.warn('[档案] 本地数据读取失败，使用默认值：', e);
      return deepMerge(DEFAULT_STATE, {});
    }
  }

  function saveState(immediate) {
    const write = () => {
      saveQueued = false;
      try {
        storageSet(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        console.error('[档案] 本地保存失败：', e);
        toast('本地保存失败：存储空间可能已满');
      }
    };
    if (immediate) return write();
    if (saveQueued) return;
    saveQueued = true;
    setTimeout(write, 180);   // 轻量防抖，避免频繁写入
  }

  // 首次访问统计
  (function touchVisit() {
    const now = new Date().toISOString();
    state.stats.visits = (state.stats.visits || 0) + 1;
    if (!state.stats.firstVisit) state.stats.firstVisit = now;
    state.stats.lastVisit = now;
    saveState(true);
  })();

  /* ------------------------------------------------------------------
     2. 影像数据辅助（内置 + 用户自定义）
     ------------------------------------------------------------------ */
  function bvOf(url) {
    if (!url) return '';
    const m = String(url).match(/BV[0-9A-Za-z]{8,12}/);
    return m ? m[0] : '';
  }
  function ytOf(input) {
    if (!input) return '';
    const s = String(input).trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    const m = s.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/);
    return m ? m[1] : '';
  }
  function normalizeVideo(v) {
    const bv = v.bv || bvOf(v.bilibili || v.bilibiliUrl || '');
    const yt = v.yt || ytOf(v.youtube || v.youtubeId || '');
    return Object.assign({}, v, {
      id: v.id,
      bv: bv,
      yt: yt,
      bilibiliUrl: bv ? 'https://www.bilibili.com/video/' + bv : (v.bilibiliUrl || ''),
      youtubeUrl: yt ? 'https://www.youtube.com/watch?v=' + yt : (v.youtubeUrl || '')
    });
  }
  function allVideos() {
    const builtin = (DATA.videos || []).map((v) => normalizeVideo(Object.assign({ builtin: true }, v)));
    const custom = (state.customVideos || []).map((v) => normalizeVideo(Object.assign({ builtin: false }, v)));
    return builtin.concat(custom);
  }
  function videoById(id) {
    return allVideos().filter((v) => v.id === id)[0] || null;
  }
  function playerUrl(v, source) {
    if (source === 'bilibili' && v.bv) {
      return 'https://player.bilibili.com/player.html?bvid=' + v.bv + '&page=1&high_quality=1&danmaku=0&autoplay=0';
    }
    if (source === 'youtube' && v.yt) {
      return 'https://www.youtube-nocookie.com/embed/' + v.yt + '?rel=0&modestbranding=1';
    }
    return '';
  }

  /* ------------------------------------------------------------------
     3. 通用渲染小部件
     ------------------------------------------------------------------ */
  function formatViews(n) {
    const v = Number(n) || 0;
    if (v >= 100000000) return (v / 100000000).toFixed(1) + ' 亿';
    if (v >= 10000) return (v / 10000).toFixed(0) + ' 万';
    return String(v);
  }

  function starsHtml(id, value, cls) {    let html = '<span class="stars ' + (cls || '') + '" data-rate-id="' + esc(id) + '">';
    for (let i = 1; i <= 5; i++) {
      html += '<button type="button" data-rate="' + i + '" class="' + (i <= value ? 'on' : '') +
        '" title="' + i + ' 星" aria-label="' + i + ' 星">★</button>';
    }
    return html + '</span>';
  }

  /* ------------------------------------------------------------------
     4. 主题
     ------------------------------------------------------------------ */
  const themeBtn = $('#themeToggle');
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (themeBtn) {
      themeBtn.textContent = theme === 'dark' ? '🌙' : '☀️';
      themeBtn.title = theme === 'dark' ? '切换到浅色主题' : '切换到深色主题';
    }
  }
  applyTheme(state.theme);
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme(state.theme);
      saveState();
      toast(state.theme === 'dark' ? '已切换到深色主题（已保存）' : '已切换到浅色主题（已保存）');
    });
  }

  /* ------------------------------------------------------------------
     5. 星海背景
     ------------------------------------------------------------------ */
  (function starfield() {
    const cvs = $('#starfield');
    if (!cvs || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = cvs.getContext('2d');
    let w, h, stars = [], raf;
    function resize() {
      w = cvs.width = window.innerWidth;
      h = cvs.height = window.innerHeight;
      const count = Math.min(160, Math.floor(w * h / 14000));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: Math.random() * 1.5 + 0.3,
        a: Math.random() * 0.6 + 0.2,
        s: Math.random() * 0.25 + 0.04,
        d: Math.random() * Math.PI * 2
      }));
    }
    function tick() {
      ctx.clearRect(0, 0, w, h);
      for (const st of stars) {
        st.y -= st.s;
        st.d += 0.01;
        if (st.y < -4) { st.y = h + 4; st.x = Math.random() * w; }
        const alpha = st.a * (0.6 + 0.4 * Math.sin(st.d));
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(226,214,180,' + alpha.toFixed(3) + ')';
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    }
    resize();
    tick();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else tick();
    });
  })();

  /* ------------------------------------------------------------------
     6. 导航：滚动阴影 / 高亮 / 移动端菜单
     ------------------------------------------------------------------ */
  (function navigation() {
    const bar = $('#topbar');
    const links = $$('.nav-link');
    const nav = $('#nav');
    const menuBtn = $('#menuToggle');

    window.addEventListener('scroll', () => {
      if (bar) bar.classList.toggle('scrolled', window.scrollY > 12);
    }, { passive: true });

    if (menuBtn && nav) {
      menuBtn.addEventListener('click', () => nav.classList.toggle('open'));
      nav.addEventListener('click', (e) => { if (e.target.closest('a')) nav.classList.remove('open'); });
    }

    const sections = ['videos', 'versions', 'awards', 'stats', 'regions', 'library']
      .map((id) => document.getElementById(id)).filter(Boolean);
    const map = new Map(sections.map((s) => [s.id, links.filter((l) => l.getAttribute('href') === '#' + s.id)[0]]));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          links.forEach((l) => l.classList.remove('active'));
          const link = map.get(en.target.id);
          if (link) link.classList.add('active');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach((s) => io.observe(s));
  })();

  /* ------------------------------------------------------------------
     7. 出现动画
     ------------------------------------------------------------------ */
  const revealIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add('in'); revealIO.unobserve(en.target); }
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  function observeReveal(scope) {
    $$('.reveal', scope || document).forEach((el) => revealIO.observe(el));
  }

  /* ------------------------------------------------------------------
     8. 首屏
     ------------------------------------------------------------------ */
  function renderHero() {
    const meta = DATA.meta || {};
    const eyebrow = $('#heroEyebrow');
    if (eyebrow) eyebrow.textContent = 'Ver. ' + (meta.latestVersion || '—') + ' · ' + (meta.latestVersionName || '');
    const versions = DATA.versions || [];
    const videos = allVideos();
    const wins = (DATA.awards || []).filter((a) => a.result === '获奖').length;
    const c0 = (DATA.counters || [])[0];
    const stats = [
      { n: versions.length, l: '收录版本数' },
      { n: videos.length, l: '影像条目' },
      { n: wins, l: '收录获奖次数' },
      c0 ? { n: c0.display || c0.value, l: c0.label } : { n: '—', l: '数据待补充' }
    ];
    const ul = $('#heroStats');
    if (ul) {
      ul.innerHTML = stats.map((s) => '<li><b>' + esc(s.n) + '</b><span>' + esc(s.l) + '</span></li>').join('');
    }
    const note = $('#heroNote');
    if (note) {
      note.textContent = '资料整理至 ' + (meta.updated || '—') + '，来源见各卡片脚注；第 ' + state.stats.visits + ' 次访问本站。';
    }
  }

  /* ------------------------------------------------------------------
     9. 实机影像馆
     ------------------------------------------------------------------ */
  const TYPE_ALL = 'all';
  function videoTypes() {
    const set = [];
    allVideos().forEach((v) => { if (v.type && set.indexOf(v.type) < 0) set.push(v.type); });
    return set;
  }
  function versionKey(v) {
    const s = String(v.version || '').trim();
    const m = s.match(/(\d+)(?:\.(\d+))?/);
    if (!m) return -1;
    return parseInt(m[1], 10) * 1000 + (m[2] ? parseInt(m[2], 10) : 0);
  }
  function renderVideoFilters() {
    const box = $('#videoFilters');
    if (!box) return;
    const types = [TYPE_ALL].concat(videoTypes());
    box.innerHTML = types.map((t) =>
      '<button class="chip ' + (state.filters.videos === t ? 'active' : '') + '" data-type="' + esc(t) + '" role="tab">' +
      (t === TYPE_ALL ? '全部类型' : esc(t)) + '</button>').join('');
  }
  function currentVideos() {
    const q = ($('#videoSearch') && $('#videoSearch').value || '').trim().toLowerCase();
    const onlyFav = $('#onlyFav') && $('#onlyFav').checked;
    const sort = ($('#videoSort') && $('#videoSort').value) || 'version-desc';
    let list = allVideos().filter((v) => {
      if (state.filters.videos !== TYPE_ALL && v.type !== state.filters.videos) return false;
      if (onlyFav && state.favorites.videos.indexOf(v.id) < 0) return false;
      if (!q) return true;
      return [v.title, v.type, v.version, v.desc, (v.tags || []).join(' ')]
        .join(' ').toLowerCase().indexOf(q) >= 0;
    });
    list.sort((a, b) => {
      if (sort === 'version-asc') return versionKey(a) - versionKey(b);
      if (sort === 'title') return String(a.title).localeCompare(String(b.title), 'zh-Hans-CN');
      if (sort === 'rating') return (state.ratings[b.id] || 0) - (state.ratings[a.id] || 0);
      return versionKey(b) - versionKey(a);
    });
    return list;
  }
  function renderVideos() {
    const grid = $('#videoGrid');
    if (!grid) return;
    const list = currentVideos();
    const empty = $('#videoEmpty');
    if (empty) empty.hidden = list.length > 0;
    grid.innerHTML = list.map((v) => {
      const fav = state.favorites.videos.indexOf(v.id) >= 0;
      const rate = state.ratings[v.id] || 0;
      const sources = [v.bv ? 'B 站' : '', v.yt ? 'YouTube' : ''].filter(Boolean).join(' · ') || '仅外链';
      const views = v.view ? ' · 播放 ' + formatViews(v.view) : '';
      return '' +
      '<article class="vcard reveal ' + (fav ? 'is-fav' : '') + '" data-id="' + esc(v.id) + '">' +
        (v.builtin === false ? '<span class="mine">我的</span>' : '') +
        '<button class="vthumb" data-play="' + esc(v.id) + '" aria-label="播放 ' + esc(v.title) + '">' +
          (v.poster ? '<img class="vposter" src="' + esc(v.poster) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') +
          '<span class="vtype">' + esc(v.type || '影像') + '</span>' +
          '<span class="vver">' + esc(v.version || '—') + '</span>' +
          '<span class="play">▶</span>' +
        '</button>' +
        '<div class="vbody">' +
          '<h3>' + esc(v.title) + '</h3>' +
          '<p class="vdesc">' + esc(v.desc || '') + '</p>' +
          '<p class="tiny">片源：' + esc(sources) + views + (v.note ? ' · ' + esc(v.note) : '') + '</p>' +
          '<div class="vfoot">' +
            '<div>' + starsHtml(v.id, rate) + '</div>' +
            '<button class="fav-btn ' + (fav ? 'on' : '') + '" data-fav-video="' + esc(v.id) + '">' +
              (fav ? '★ 已收藏' : '☆ 收藏') + '</button>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');
    observeReveal(grid);
  }

  // 事件委托：影像区
  (function videoEvents() {
    const sec = $('#videos');
    if (!sec) return;
    sec.addEventListener('click', (e) => {
      const play = e.target.closest('[data-play]');
      if (play) { openPlayer(play.getAttribute('data-play')); return; }
      const fav = e.target.closest('[data-fav-video]');
      if (fav) { toggleFavVideo(fav.getAttribute('data-fav-video')); return; }
      const chip = e.target.closest('.chip[data-type]');
      if (chip) {
        state.filters.videos = chip.getAttribute('data-type');
        saveState(); renderVideoFilters(); renderVideos();
        return;
      }
      const rateBtn = e.target.closest('.stars[data-rate-id] button');
      if (rateBtn) {
        const box = rateBtn.closest('.stars');
        const id = box.getAttribute('data-rate-id');
        const val = parseInt(rateBtn.getAttribute('data-rate'), 10);
        state.ratings[id] = state.ratings[id] === val ? 0 : val;
        saveState();
        $$('button', box).forEach((b) => b.classList.toggle('on', parseInt(b.getAttribute('data-rate'), 10) <= state.ratings[id]));
        toast(state.ratings[id] ? '已评分 ' + state.ratings[id] + ' 星（已保存在本地）' : '已取消评分');
      }
    });
    const search = $('#videoSearch');
    if (search) search.addEventListener('input', debounce(renderVideos, 160));
    // 封面图加载失败（防盗链/离线）时优雅降级为渐变占位
    const grid = $('#videoGrid');
    if (grid) grid.addEventListener('error', (e) => {
      if (e.target && e.target.tagName === 'IMG') e.target.remove();
    }, true);
    const sort = $('#videoSort');
    if (sort) sort.addEventListener('change', renderVideos);
    const fav = $('#onlyFav');
    if (fav) fav.addEventListener('change', renderVideos);
  })();

  function toggleFavVideo(id) {
    const i = state.favorites.videos.indexOf(id);
    if (i >= 0) state.favorites.videos.splice(i, 1);
    else state.favorites.videos.push(id);
    saveState();
    toast(i >= 0 ? '已取消收藏' : '已加入收藏（保存在本地）');
    renderVideos(); renderLibrary();
  }

  /* ------------------------------------------------------------------
     10. 播放器弹层
     ------------------------------------------------------------------ */
  const modal = $('#playerModal');
  let currentVideoId = null;
  let currentSource = 'bilibili';

  function openPlayer(id) {
    const v = videoById(id);
    if (!v) return;
    currentVideoId = id;
    currentSource = v.bv ? 'bilibili' : (v.yt ? 'youtube' : 'none');
    pushHistory(v);
    if (modal) modal.hidden = false;
    document.body.style.overflow = 'hidden';
    renderPlayer();
    const note = $('#playerNote');
    if (note) note.value = state.notes[id] || '';
    setTimeout(() => { const nb = $('#playerNote'); if (nb) nb.focus({ preventScroll: true }); }, 120);
  }
  function closePlayer() {
    if (modal) modal.hidden = true;
    document.body.style.overflow = '';
    const frame = $('#playerFrame');
    if (frame) frame.innerHTML = '';   // 停止播放
    currentVideoId = null;
  }
  function renderPlayer() {
    const v = videoById(currentVideoId);
    if (!v) return;
    const title = $('#playerTitle'), meta = $('#playerMeta'), tabs = $('#playerTabs'),
      frame = $('#playerFrame'), rate = $('#playerRate'), favBtn = $('#playerFav'), ext = $('#playerExternal');

    if (title) title.textContent = v.title;
    if (meta) meta.textContent = [v.type, v.version, v.builtin === false ? '我的自定义条目' : '官方影像'].filter(Boolean).join(' · ');

    const sources = [];
    if (v.bv) sources.push({ key: 'bilibili', label: 'Bilibili · ' + v.bv, href: v.bilibiliUrl });
    if (v.yt) sources.push({ key: 'youtube', label: 'YouTube · ' + v.yt, href: v.youtubeUrl });
    if (tabs) {
      tabs.innerHTML = sources.map((s) =>
        '<button class="chip ' + (s.key === currentSource ? 'active' : '') + '" data-source="' + s.key + '" data-href="' + esc(s.href) + '">' + esc(s.label) + '</button>'
      ).join('') || '<span class="chip active">无内嵌源，请使用右侧原站链接</span>';
    }
    if (frame) {
      const url = playerUrl(v, currentSource);
      if (url) {
        frame.innerHTML = '<iframe src="' + esc(url) + '" scrolling="no" frameborder="0" ' +
          'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" ' +
          'allowfullscreen title="' + esc(v.title) + '"></iframe>';
      } else {
        frame.innerHTML = '<div class="fallback"><div><p>该条目没有可内嵌的片源。</p>' +
          '<p class="tiny">可在「我的档案」中补上 BV 号或 YouTube ID。</p></div></div>';
      }
    }
    if (rate) rate.innerHTML = '我的评分：' + starsHtml(v.id, state.ratings[v.id] || 0, 'big');
    if (favBtn) {
      const on = state.favorites.videos.indexOf(v.id) >= 0;
      favBtn.textContent = on ? '★ 已收藏' : '☆ 收藏';
      favBtn.dataset.fav = v.id;
    }
    if (ext) {
      const target = v.bilibiliUrl || v.youtubeUrl || '#';
      ext.href = target;
      ext.hidden = !target || target === '#';
    }
  }
  (function playerEvents() {
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) { closePlayer(); return; }
        const tab = e.target.closest('[data-source]');
        if (tab) { currentSource = tab.getAttribute('data-source'); renderPlayer(); return; }
        const rateBtn = e.target.closest('.stars button');
        if (rateBtn && currentVideoId) {
          const val = parseInt(rateBtn.getAttribute('data-rate'), 10);
          state.ratings[currentVideoId] = state.ratings[currentVideoId] === val ? 0 : val;
          saveState(); renderPlayer(); renderVideos();
          toast('评分已保存到本地');
          return;
        }
        const favBtn = e.target.closest('#playerFav');
        if (favBtn) { toggleFavVideo(currentVideoId); renderPlayer(); }
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && !modal.hidden) closePlayer();
    });
    const note = $('#playerNote');
    if (note) {
      note.addEventListener('input', debounce(() => {
        if (!currentVideoId) return;
        const val = note.value.trim();
        if (val) state.notes[currentVideoId] = val; else delete state.notes[currentVideoId];
        saveState(); renderLibrary();
      }, 400));
    }
  })();

  function pushHistory(v) {
    state.history = (state.history || []).filter((h) => h.id !== v.id);
    state.history.unshift({ id: v.id, title: v.title, ts: Date.now() });
    state.history = state.history.slice(0, 20);
    saveState();
    renderLibrary();
  }

  /* ------------------------------------------------------------------
     11. 版本里程碑
     ------------------------------------------------------------------ */
  function renderVersionProgress() {
    const box = $('#versionProgress');
    if (!box) return;
    const total = (DATA.versions || []).length;
    const done = (state.reviewed || []).length;
    const pct = total ? Math.round(done / total * 100) : 0;
    box.innerHTML =
      '<div class="progress-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="progress-text"><span>已回顾 ' + done + ' / ' + total + ' 个版本</span><span>' + pct + '%</span></div>';
  }
  function currentVersions() {
    const q = ($('#versionSearch') && $('#versionSearch').value || '').trim().toLowerCase();
    const era = state.filters.versionEra;
    const onlyRev = $('#onlyReviewed') && $('#onlyReviewed').checked;
    return (DATA.versions || []).filter((v) => {
      if (era !== 'all' && String(v.era) !== String(era)) return false;
      if (onlyRev && state.reviewed.indexOf(v.v) < 0) return false;
      if (!q) return true;
      return [v.v, v.name, v.desc, v.region, (v.tags || []).join(' '), (v.chars || []).join(' ')]
        .join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function renderVersions() {
    const tl = $('#versionTimeline');
    if (!tl) return;
    const list = currentVersions();
    const empty = $('#versionEmpty');
    if (empty) empty.hidden = list.length > 0;
    tl.innerHTML = list.map((v) => {
      const done = state.reviewed.indexOf(v.v) >= 0;
      return '' +
      '<div class="titem reveal ' + (done ? 'reviewed' : '') + '" data-v="' + esc(v.v) + '">' +
        '<div class="tcard">' +
          '<div class="thead">' +
            '<span class="tver">' + esc(v.v) + '</span>' +
            '<span class="tname">' + esc(v.name) + '</span>' +
            '<span class="tdate">' + esc(v.date) + '</span>' +
          '</div>' +
          '<p class="tdesc">' + esc(v.desc || '') + '</p>' +
          '<div class="ttags">' +
            (v.region ? '<span class="tag region">📍 ' + esc(v.region) + '</span>' : '') +
            (v.chars || []).map((c) => '<span class="tag">' + esc(c) + '</span>').join('') +
          '</div>' +
          '<button class="review-toggle" data-review="' + esc(v.v) + '">' + (done ? '✓ 已回顾（点击取消）' : '标记为已回顾') + '</button>' +
          '<button class="review-toggle" data-find="' + esc(v.v) + '">🔍 查看该版本影像</button>' +
        '</div>' +
      '</div>';
    }).join('');
    observeReveal(tl);
    renderVersionProgress();
  }
  (function versionEvents() {
    const sec = $('#versions');
    if (!sec) return;
    sec.addEventListener('click', (e) => {
      // 跳到影像馆并检索该版本
      const find = e.target.closest('[data-find]');
      if (find) {
        const ver = find.getAttribute('data-find');
        const search = $('#videoSearch');
        if (search) {
          search.value = ver;
          const fav = $('#onlyFav'); if (fav) fav.checked = false;
          state.filters.videos = TYPE_ALL;
          saveState();
          renderVideoFilters();
          renderVideos();
        }
        const hits = currentVideos();
        if (hits.length) {
          const target = $('#videos');
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          toast('影像馆已筛选出 ' + hits.length + ' 条与 ' + ver + ' 相关的影像');
        } else {
          window.open('https://search.bilibili.com/all?keyword=' + encodeURIComponent('原神 ' + ver + ' 版本PV'), '_blank', 'noopener');
          toast('站内暂无 ' + ver + ' 影像，已为你打开 B 站搜索结果');
        }
        return;
      }
      const btn = e.target.closest('[data-review]');
      if (!btn) return;
      const v = btn.getAttribute('data-review');
      const i = state.reviewed.indexOf(v);
      if (i >= 0) state.reviewed.splice(i, 1); else state.reviewed.push(v);
      saveState();
      const item = btn.closest('.titem');
      if (item) item.classList.toggle('reviewed', i < 0);
      btn.textContent = i < 0 ? '✓ 已回顾（点击取消）' : '标记为已回顾';
      renderVersionProgress();
      toast(i < 0 ? '已标记 ' + v + ' 为已回顾（本地保存）' : '已取消 ' + v + ' 的回顾标记');
    });
    const s = $('#versionSearch');
    if (s) s.addEventListener('input', debounce(renderVersions, 160));
    const era = $('#versionEra');
    if (era) {
      era.value = state.filters.versionEra;
      era.addEventListener('change', () => {
        state.filters.versionEra = era.value; saveState(); renderVersions();
      });
    }
    const only = $('#onlyReviewed');
    if (only) only.addEventListener('change', renderVersions);
  })();

  /* ------------------------------------------------------------------
     12. 获奖记录
     ------------------------------------------------------------------ */
  function renderAwardYears() {
    const box = $('#awardYears');
    if (!box) return;
    const years = [];
    (DATA.awards || []).forEach((a) => { if (years.indexOf(a.year) < 0) years.push(a.year); });
    years.sort((a, b) => b - a);
    const items = [{ key: 'all', label: '全部年份' }].concat(years.map((y) => ({ key: String(y), label: y + ' 年' })));
    box.innerHTML = items.map((it) =>
      '<button class="chip ' + (String(state.filters.awards) === it.key ? 'active' : '') + '" data-year="' + esc(it.key) + '">' + esc(it.label) + '</button>').join('');
  }
  function currentAwards() {
    const q = ($('#awardSearch') && $('#awardSearch').value || '').trim().toLowerCase();
    const res = ($('#awardResult') && $('#awardResult').value) || 'all';
    return (DATA.awards || []).filter((a) => {
      if (state.filters.awards !== 'all' && String(a.year) !== String(state.filters.awards)) return false;
      if (res !== 'all' && a.result !== res) return false;
      if (!q) return true;
      return [a.title, a.org, a.note, a.year].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function renderAwards() {
    const grid = $('#awardGrid');
    if (!grid) return;
    const list = currentAwards();
    const empty = $('#awardEmpty');
    if (empty) empty.hidden = list.length > 0;
    grid.innerHTML = list.map((a) => {
      const fav = state.favorites.awards.indexOf(a.id) >= 0;
      return '' +
      '<article class="acard reveal ' + (fav ? 'is-fav' : '') + '" data-id="' + esc(a.id) + '">' +
        '<p class="ayear">' + esc(a.year) + ' · ' + esc(a.org) + '</p>' +
        '<h3>' + esc(a.title) + '</h3>' +
        '<span class="res ' + (a.result === '获奖' ? 'win' : 'nom') + '">' + esc(a.result) + '</span>' +
        (a.note ? '<p class="anote">' + esc(a.note) + '</p>' : '') +
        (a.source ? '<p class="tiny">来源：<a href="' + esc(a.source) + '" target="_blank" rel="noopener">' + esc(a.sourceLabel || '链接') + '</a></p>' : '') +
        '<button class="fav-btn ' + (fav ? 'on' : '') + '" data-fav-award="' + esc(a.id) + '">' + (fav ? '★' : '☆') + '</button>' +
      '</article>';
    }).join('');
    observeReveal(grid);
  }
  (function awardEvents() {
    const sec = $('#awards');
    if (!sec) return;
    sec.addEventListener('click', (e) => {
      const year = e.target.closest('.chip[data-year]');
      if (year) {
        state.filters.awards = year.getAttribute('data-year');
        saveState(); renderAwardYears(); renderAwards();
        return;
      }
      const fav = e.target.closest('[data-fav-award]');
      if (fav) {
        const id = fav.getAttribute('data-fav-award');
        const i = state.favorites.awards.indexOf(id);
        if (i >= 0) state.favorites.awards.splice(i, 1); else state.favorites.awards.push(id);
        saveState(); renderAwards(); renderLibrary();
        toast(i >= 0 ? '已取消收藏' : '已收藏该奖项（本地保存）');
      }
    });
    const s = $('#awardSearch');
    if (s) s.addEventListener('input', debounce(renderAwards, 160));
    const r = $('#awardResult');
    if (r) r.addEventListener('change', renderAwards);
  })();

  /* ------------------------------------------------------------------
     13. 数据里程碑（数字滚动）
     ------------------------------------------------------------------ */
  function renderCounters() {
    const grid = $('#counterGrid');
    if (!grid) return;
    grid.innerHTML = (DATA.counters || []).map((c) => '' +
      '<div class="counter reveal" data-target="' + esc(c.value) + '" data-decimals="' + (c.decimals || 0) + '" ' +
      'data-prefix="' + esc(c.prefix || '') + '" data-suffix="' + esc(c.suffix || '') + '">' +
        '<b>0</b><span>' + esc(c.label) + '</span>' +
      '</div>').join('');
    observeReveal(grid);
  }
  const counterIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      counterIO.unobserve(en.target);
      const el = en.target;
      const target = parseFloat(el.getAttribute('data-target')) || 0;
      const dec = parseInt(el.getAttribute('data-decimals') || '0', 10);
      const pre = el.getAttribute('data-prefix') || '';
      const suf = el.getAttribute('data-suffix') || '';
      const b = $('b', el);
      const start = performance.now(), dur = 1400;
      (function step(now) {
        const p = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        const val = target * eased;
        if (b) b.textContent = pre + (dec ? val.toFixed(dec) : Math.round(val).toLocaleString('en-US')) + suf;
        if (p < 1) requestAnimationFrame(step);
      })(start);
    });
  }, { rootMargin: '0px 0px -10% 0px' });
  function observeCounters() { $$('.counter').forEach((el) => counterIO.observe(el)); }

  function renderMilestones() {
    const grid = $('#milestoneGrid');
    if (!grid) return;
    grid.innerHTML = (DATA.milestones || []).map((m) => '' +
      '<article class="mcard reveal">' +
        '<p class="mdate">' + esc(m.date) + '</p>' +
        '<h3>' + esc(m.title) + '</h3>' +
        '<p>' + esc(m.desc) + '</p>' +
        (m.source ? '<p class="src">来源：<a href="' + esc(m.source) + '" target="_blank" rel="noopener">' + esc(m.sourceLabel || m.source) + '</a></p>' : '') +
      '</article>').join('');
    observeReveal(grid);
  }

  /* ------------------------------------------------------------------
     14. 七国
     ------------------------------------------------------------------ */
  function renderRegions() {
    const grid = $('#regionGrid');
    if (!grid) return;
    grid.innerHTML = (DATA.regions || []).map((r) => '' +
      '<article class="rcard reveal" style="--c:' + esc(r.color) + '">' +
        '<div class="relem">' + esc(r.elem) + '</div>' +
        '<h3>' + esc(r.name) + '</h3>' +
        '<p class="rsub">' + esc(r.archon || '') + (r.version ? ' · Ver. ' + esc(r.version) : '') + '</p>' +
        '<p>' + esc(r.desc) + '</p>' +
      '</article>').join('');
    observeReveal(grid);
  }

  /* ------------------------------------------------------------------
     15. 我的档案（本地数据面板）
     ------------------------------------------------------------------ */
  function renderLibrary() {
    // 收藏影像
    const favVideos = $('#favVideoList');
    const favCount = $('#favVideoCount');
    const favIds = state.favorites.videos;
    if (favCount) favCount.textContent = favIds.length;
    if (favVideos) {
      favVideos.innerHTML = favIds.length ? favIds.map((id) => {
        const v = videoById(id);
        if (!v) return '';
        const note = state.notes[id] || '';
        return '<li><div class="li-main"><b>' + esc(v.title) + '</b>' +
          '<small>' + esc([v.type, v.version].filter(Boolean).join(' · ')) + ' · 评分 ' + (state.ratings[id] || 0) + '/5</small>' +
          (note ? '<div class="li-note">' + esc(note) + '</div>' : '') +
          '<a href="#" data-open="' + esc(id) + '">打开播放器</a></div>' +
          '<button data-remove-fav="' + esc(id) + '" title="取消收藏">✕</button></li>';
      }).join('') : '<li>还没有收藏影像，去影像馆点 ☆ 收藏吧。</li>';
    }
    // 收藏奖项
    const favAwards = $('#favAwardList');
    const favACount = $('#favAwardCount');
    if (favACount) favACount.textContent = state.favorites.awards.length;
    if (favAwards) {
      favAwards.innerHTML = state.favorites.awards.length ? state.favorites.awards.map((id) => {
        const a = (DATA.awards || []).filter((x) => x.id === id)[0];
        if (!a) return '';
        return '<li><div class="li-main"><b>' + esc(a.title) + '</b><small>' + esc(a.year + ' · ' + a.org + ' · ' + a.result) + '</small></div>' +
          '<button data-remove-fav-award="' + esc(id) + '" title="取消收藏">✕</button></li>';
      }).join('') : '<li>还没有收藏奖项。</li>';
    }
    // 笔记
    const notes = $('#noteList');
    if (notes) {
      notes.innerHTML = (state.userNotes || []).length ? state.userNotes.map((n) => '' +
        '<li><div class="li-main"><b>' + esc(n.title || '（无标题笔记）') + '</b>' +
        '<small>' + new Date(n.ts).toLocaleString('zh-CN') + '</small>' +
        '<div class="li-note">' + esc(n.body) + '</div></div>' +
        '<button data-remove-note="' + esc(n.id) + '" title="删除">✕</button></li>').join('')
        : '<li>还没有笔记。</li>';
    }
    // 观看历史
    const hist = $('#historyList');
    const hCount = $('#historyCount');
    if (hCount) hCount.textContent = (state.history || []).length;
    if (hist) {
      hist.innerHTML = (state.history || []).length ? state.history.map((h) => '' +
        '<li><div class="li-main"><b>' + esc(h.title) + '</b>' +
        '<small>' + new Date(h.ts).toLocaleString('zh-CN') + '</small>' +
        '<a href="#" data-open="' + esc(h.id) + '">再次观看</a></div></li>').join('')
        : '<li>还没有观看记录。</li>';
    }
    // 存储概览
    const store = $('#storageList');
    if (store) {
      let size = 0;
      try { size = new Blob([storageGet(STORAGE_KEY) || '']).size; } catch (e) { size = 0; }
      const rows = [
        ['本地键名', STORAGE_KEY],
        ['存储状态', STORAGE_OK ? '正常（localStorage 可用）' : '受限：当前环境禁用了 localStorage，数据仅保留在本次会话中'],
        ['占用空间', (size / 1024).toFixed(2) + ' KB'],
        ['访问次数', String(state.stats.visits)],
        ['首次访问', state.stats.firstVisit ? new Date(state.stats.firstVisit).toLocaleString('zh-CN') : '—'],
        ['最近访问', state.stats.lastVisit ? new Date(state.stats.lastVisit).toLocaleString('zh-CN') : '—'],
        ['已评分影像', String(Object.keys(state.ratings).filter((k) => state.ratings[k] > 0).length)],
        ['影像笔记', String(Object.keys(state.notes).length)],
        ['自定义影像', String((state.customVideos || []).length)],
        ['已回顾版本', String((state.reviewed || []).length)],
        ['主题', state.theme === 'dark' ? '深色' : '浅色']
      ];
      store.innerHTML = rows.map((r) => '<li><div class="li-main"><b>' + esc(r[0]) + '</b><small>' + esc(r[1]) + '</small></div></li>').join('');
    }
  }

  (function libraryEvents() {
    const sec = $('#library');
    if (sec) {
      sec.addEventListener('click', (e) => {
        const open = e.target.closest('[data-open]');
        if (open) { e.preventDefault(); openPlayer(open.getAttribute('data-open')); return; }
        const rf = e.target.closest('[data-remove-fav]');
        if (rf) { toggleFavVideo(rf.getAttribute('data-remove-fav')); return; }
        const ra = e.target.closest('[data-remove-fav-award]');
        if (ra) {
          const id = ra.getAttribute('data-remove-fav-award');
          state.favorites.awards = state.favorites.awards.filter((x) => x !== id);
          saveState(); renderAwards(); renderLibrary(); toast('已取消收藏');
          return;
        }
        const rn = e.target.closest('[data-remove-note]');
        if (rn) {
          const id = rn.getAttribute('data-remove-note');
          state.userNotes = state.userNotes.filter((n) => n.id !== id);
          saveState(); renderLibrary(); toast('笔记已删除');
        }
      });
    }
    const form = $('#noteForm');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const title = $('#noteTitle').value.trim();
        const body = $('#noteBody').value.trim();
        if (!body) return;
        state.userNotes.unshift({ id: 'n_' + Date.now().toString(36), title: title, body: body, ts: Date.now() });
        state.userNotes = state.userNotes.slice(0, 50);
        saveState(true);
        $('#noteTitle').value = ''; $('#noteBody').value = '';
        renderLibrary();
        toast('笔记已保存到浏览器本地存储');
      });
    }
  })();

  /* ------------------------------------------------------------------
     16. 自定义影像添加 / 导出 / 导入 / 清空
     ------------------------------------------------------------------ */
  (function dataTools() {
    const addForm = $('#addVideoForm');
    if (addForm) {
      addForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const f = new FormData(addForm);
        const get = (k) => String(f.get(k) || '').trim();
        const bv = bvOf(get('bilibili'));
        const yt = ytOf(get('youtube'));
        if (!bv && !yt) { toast('请至少填写 Bilibili BV 号或 YouTube 链接'); return; }
        const item = {
          id: 'u_' + Date.now().toString(36),
          title: get('title') || '我的影像',
          type: get('type') || '玩家录像',
          version: get('version') || '—',
          desc: '由我添加的本地条目。',
          note: get('note'),
          bv: bv, yt: yt,
          builtin: false
        };
        state.customVideos.push(item);
        saveState(true);
        addForm.reset();
        renderVideoFilters(); renderVideos(); renderLibrary();
        toast('已添加，保存在浏览器本地存储');
      });
    }

    const exportBtn = $('#exportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const payload = {
          app: '提瓦特档案 · 原神资料站',
          exportedAt: new Date().toISOString(),
          state: state
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'genshin-archive-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        toast('已导出本地数据备份');
      });
    }

    const importFile = $('#importFile');
    if (importFile) {
      importFile.addEventListener('change', () => {
        const file = importFile.files && importFile.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const parsed = JSON.parse(String(reader.result));
            const incoming = parsed && parsed.state ? parsed.state : parsed;
            state = deepMerge(DEFAULT_STATE, incoming);
            saveState(true);
            applyTheme(state.theme);
            renderAll();
            toast('备份已导入并写入本地存储');
          } catch (err) {
            console.error(err);
            toast('导入失败：文件不是有效的 JSON 备份');
          }
          importFile.value = '';
        };
        reader.readAsText(file);
      });
    }

    const clearBtn = $('#clearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (!confirm('确定清空本地收藏、评分、笔记与历史记录吗？此操作不可撤销。')) return;
        const keepVisits = state.stats.visits;
        state = deepMerge(DEFAULT_STATE, { stats: { visits: keepVisits, firstVisit: state.stats.firstVisit, lastVisit: state.stats.lastVisit } });
        saveState(true);
        applyTheme(state.theme);
        renderAll();
        toast('本地数据已清空');
      });
    }
  })();

  /* ------------------------------------------------------------------
     17. 页脚
     ------------------------------------------------------------------ */
  function renderFooter() {
    const meta = DATA.meta || {};
    const el = $('#footerMeta');
    if (el) {
      el.textContent = '资料整理至 ' + (meta.updated || '—') + ' · 当前最新版本 Ver. ' + (meta.latestVersion || '—') +
        '（' + (meta.latestVersionName || '') + '） · 内置影像 ' + (DATA.videos || []).length + ' 条 · 页面数据与交互逻辑均为纯前端实现。';
    }
  }

  /* ------------------------------------------------------------------
     18. 初始化
     ------------------------------------------------------------------ */
  function debounce(fn, wait) {
    let t = null;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), wait);
    };
  }

  function renderAll() {
    renderHero();
    renderVideoFilters();
    renderVideos();
    renderVersions();
    renderAwardYears();
    renderAwards();
    renderCounters();
    observeCounters();
    renderMilestones();
    renderRegions();
    renderLibrary();
    renderFooter();
    observeReveal(document);
  }

  if (typeof DATA === 'undefined') {
    console.error('[档案] 未找到 data.js，无法渲染数据。');
    document.body.insertAdjacentHTML('afterbegin',
      '<p style="padding:20px;color:#ff9d86">数据文件 js/data.js 未加载，请确认文件结构与 index.html 同级。</p>');
    return;
  }
  renderAll();
  // 让首屏数字先滚动一次
  setTimeout(observeCounters, 600);

  // 本地存储不可用时给出明确提示（例如某些浏览器在 file:// 下禁用 localStorage）
  if (!STORAGE_OK) {
    document.body.insertAdjacentHTML('afterbegin',
      '<div class="warn-banner" role="alert">⚠️ 当前浏览器环境禁用了 <code>localStorage</code>，收藏与笔记只在本次会话中有效。' +
      '请在项目目录执行 <code>python -m http.server 8080</code>（或双击 <code>启动本地服务器.bat</code>）后通过 http://localhost 访问本站，即可正常持久化保存。</div>');
  }

  console.log('%c提瓦特档案 · 原神资料站 已加载', 'color:#d3bc8e',
    '本地存储键：' + STORAGE_KEY + ' · 存储可用：' + STORAGE_OK);
})();
