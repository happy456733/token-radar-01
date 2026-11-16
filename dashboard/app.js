// Token Radar dashboard — renders window.RADAR (embedded in data.js, no network).
// Views: pre-token board, live tokens, value model. Rows sort by clicking a
// header; filters narrow by text, category, chain and TVL. A row opens its
// detail view: the valuation breakdown and the six farm steps.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.body.innerHTML = '<p style="padding:30px">Radar data failed to load.</p>'; return; }

  var $ = function (id) { return document.getElementById(id); };
  var rowsEl = $('rows'), boardEl = $('board'), detailEl = $('detail'), modelEl = $('modelview');
  var state = { view: 'board', q: '', cat: '', chain: '', minTvl: 0, sort: 'rank', dir: 1, detail: null };

  function money(n) {
    if (n === null || n === undefined) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(0);
  }
  function pct(n) {
    if (n === null || n === undefined) return '<span class="flat">—</span>';
    var cls = n > 0.05 ? 'up' : n < -0.05 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(2) + '%</span>';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days < 30) return days + 'd';
    if (days < 365) return Math.floor(days / 30) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }
  function chips(list) {
    return list.slice(0, 3).map(function (c) { return '<span class="tagchip">' + esc(c) + '</span>'; }).join('');
  }

  // ---- stats + filter options -------------------------------------------
  var cats = [], chains = [];
  R.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  cats.forEach(function (c) { $('cat').add(new Option(c, c)); });
  chains.forEach(function (c) { $('chain').add(new Option(c, c)); });
  $('stats').innerHTML =
    '<div class="stat"><b>' + R.board_size + '</b><span>ranked</span></div>' +
    '<div class="stat"><b>' + R.watchlist_size + '</b><span>watchlist</span></div>' +
    '<div class="stat"><b>' + R.early_size + '</b><span>early finds</span></div>' +
    '<div class="stat"><b>' + R.live_size + '</b><span>live tokens</span></div>';
  $('src').textContent = R.source + ' · as of ' + R.as_of;
  $('mver').textContent = R.model_version;

  // ---- filtering + sorting ----------------------------------------------
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = R.rows.filter(function (r) {
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort, dir = state.dir;
    list.sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string') return dir * av.localeCompare(bv);
      return dir * (av - bv);
    });
    return list;
  }

  function renderBoard() {
    var list = filtered();
    $('count').textContent = list.length + ' of ' + R.board_size + ' protocols';
    if (!list.length) {
      rowsEl.innerHTML = '<tr><td colspan="9" class="empty">No protocols match these filters.</td></tr>';
      return;
    }
    rowsEl.innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + chips(r.chains || []) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + ageLabel(r.age_days) + '</td>' +
        '<td><button class="planbtn" data-plan="' + esc(r.slug) + '">Plan</button></td></tr>';
    }).join('');
  }

  function renderLive() {
    $('count').textContent = R.live_size + ' live-token protocols (market value, not ranked)';
    rowsEl.innerHTML = R.live.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="rank">●</td>' +
        '<td class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + chips(r.chains || []) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num"><b>' + money(r.mcap_usd) + '</b></td>' +
        '<td class="num">trading</td>' +
        '<td><span class="flat">—</span></td></tr>';
    }).join('');
  }

  function renderModel() {
    modelEl.innerHTML = '<h2>Value model — ' + esc(R.model_version) + '</h2>' +
      '<p>Implied value = TVL × category multiple × growth multiplier × tenure multiplier.</p>' +
      '<p>Each category&rsquo;s multiple is the median market-cap-per-TVL of its live-token protocols in this snapshot ' +
      '(global median ' + R.global_multiple.toFixed(3) + ' where a category has fewer than 3 live comparables). ' +
      'Growth uses the 7-day TVL change clamped to [' + R.model.growth_floor + '%, +' + R.model.growth_cap + '%] at weight ' +
      R.model.growth_weight + '. Tenure runs from ' + R.model.tenure_floor + ' (new) to ' + R.model.tenure_top +
      ' (4+ years tokenless); an unknown listing date scores ' + R.model.unknown_tenure + '.</p>' +
      '<table><thead><tr><th>Category</th><th>Multiple</th><th>Live comparables</th></tr></thead><tbody>' +
      R.multiples.map(function (m) {
        return '<tr><td>' + esc(m.category) + '</td><td class="num">' + m.multiple.toFixed(3) + '×</td><td class="num">' + m.comparables + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  // ---- detail view --------------------------------------------------------
  function findRow(slug) {
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) return R.rows[i];
    return null;
  }
  function renderDetail() {
    var r = state.detail ? findRow(state.detail) : null;
    if (!r) { detailEl.hidden = true; detailEl.innerHTML = ''; return; }
    var base = r.tvl_usd * r.multiple;
    detailEl.innerHTML =
      '<button class="close" id="closeDetail">Close ✕</button>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + ' <span>' + esc(r.slug) + ' · ' + esc(r.category || 'uncategorised') + ' · ' + esc((r.chains || []).join(', ')) + '</span></h2>' +
      '<div class="meta"><span>TVL <b>' + money(r.tvl_usd) + '</b></span>' +
      '<span>7-day change <b>' + (r.change_7d === null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(2) + '%') + '</b></span>' +
      '<span>Implied value <b>' + money(r.implied_value_usd) + '</b></span>' +
      '<span>Tokenless for <b>' + ageLabel(r.age_days) + '</b></span>' +
      '<span>Listed <b>' + esc(r.listed_at || 'unknown') + '</b></span></div>' +
      '<h3>How the value is built</h3><table>' +
      '<tr><td>Category multiple</td><td><b>' + r.multiple.toFixed(3) + '×</b> — ' + esc(r.multiple_source) + '</td></tr>' +
      '<tr><td>Base value (TVL × multiple)</td><td><b>' + money(base) + '</b></td></tr>' +
      '<tr><td>Growth multiplier</td><td><b>' + r.growth_multiplier.toFixed(3) + '×</b></td></tr>' +
      '<tr><td>Tenure multiplier</td><td><b>' + r.tenure_multiplier.toFixed(3) + '×</b></td></tr>' +
      '<tr><td>Implied value</td><td><b>' + money(r.implied_value_usd) + '</b></td></tr></table>' +
      '<h3>Farm plan — six steps</h3><ol>' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    detailEl.hidden = false;
    $('closeDetail').addEventListener('click', function () { setDetail(null); });
  }

  // ---- view switching + hash ----------------------------------------------
  function setView(v) {
    state.view = v;
    document.querySelectorAll('#views button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === v);
    });
    $('controls').style.display = v === 'board' ? '' : 'none';
    boardEl.style.display = v === 'model' ? 'none' : '';
    modelEl.hidden = v !== 'model';
    if (v === 'board') renderBoard();
    else if (v === 'live') renderLive();
    else renderModel();
  }
  function setDetail(slug) {
    state.detail = slug;
    renderDetail();
    if (state.view === 'board') renderBoard();
    if (slug) detailEl.scrollIntoView({ block: 'nearest' });
  }
  function readHash() {
    var h = location.hash.replace(/^#/, '');
    var parts = h.split('&');
    parts.forEach(function (p) {
      var kv = p.split('=');
      var k = kv[0], v = decodeURIComponent(kv[1] || '');
      if (k === 'view' && (v === 'board' || v === 'live' || v === 'model')) state.view = v;
      if (k === 'detail') state.detail = v || null;
      if (k === 'cat') { state.cat = v; $('cat').value = v; }
      if (k === 'q') { state.q = v; $('q').value = v; }
      if (k === 'chain') { state.chain = v; $('chain').value = v; }
    });
  }

  // ---- events ---------------------------------------------------------------
  document.querySelectorAll('#views button').forEach(function (b) {
    b.addEventListener('click', function () { setView(b.dataset.view); });
  });
  $('q').addEventListener('input', function () { state.q = this.value; renderBoard(); });
  $('cat').addEventListener('change', function () { state.cat = this.value; renderBoard(); });
  $('chain').addEventListener('change', function () { state.chain = this.value; renderBoard(); });
  $('minTvl').addEventListener('change', function () { state.minTvl = +this.value; renderBoard(); });
  boardEl.querySelectorAll('th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.dataset.sort;
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
      boardEl.querySelectorAll('th').forEach(function (t) { t.classList.remove('sorted'); });
      th.classList.add('sorted');
      if (state.view === 'board') renderBoard();
    });
  });
  rowsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-plan]');
    var tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    if (btn || tr) setDetail(tr.dataset.slug);
  });

  readHash();
  setView(state.view);
  renderDetail();
  window.addEventListener('hashchange', function () {
    readHash();
    setView(state.view);
    renderDetail();
  });
})();
