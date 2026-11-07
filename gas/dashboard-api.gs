/**
 * ONE-BALANCE 経営ダッシュボード用API
 * 台帳（事務部隊_経理台帳）などから数字を返す。
 *
 * 【v2：長尾だけが見られる数字はパスワードで守る】
 *   ?action=getDashboard           … 誰でも見てよい数字（売上・KPI・会員数）。経費・利益・HAPPY KIDSは入っていない
 *   ?action=getPrivate&token=XXXX  … 長尾だけ。経費・利益・HAPPY KIDS・固定経費。ログインで受け取った合言葉(token)が必要
 *   POST {"action":"login","pw":"..."} … パスワードが合えばtokenを返す
 *
 * パスワードはこのファイルに書かない。Apps Scriptの
 *   プロジェクトの設定 → スクリプト プロパティ → 「OWNER_PASSWORD」
 * に入れる（検索ワード：OWNER_PASSWORD）。
 */
var LEDGER_ID  = '1UB2GAO_-aX7SE7t9l4tNAsJJr7NhpzTCMcgYO_AZ9TM'; // 事務部隊_経理台帳
var TAIKAI_ID  = '18TPuqVVVbO7Fbc1pL6XheeXuFtLVdXe0agpQRNXeFr0'; // 2026大会&スポンサー
var PARTNER_ID = '13BOp0lg7tFE4ZpkeJspsa9fc9YkdYZeHGxLf1ZhrQc4'; // HAPPY KIDS PROJECT パートナー契約・更新管理
var BOXING_MASTER_ID = '1J-bu8590Snq--Xtf76wsYemK_SYCO_5KlObjM03r2BM'; // ワンバランス会員マスタ（会員マスタ／体験者フォーム）
var ONETRE_ID = '1LYNNK1_gY3UvrAGgErfOmR00lXsigZYry8RWeBIUWKk';         // パーソナルONE-TRE申込み（回答）（会員／体験）

// ===== 設定エリア（検索ワード：DASH_CONFIG）=====
var STAFF_NAMES = ['長尾儀弘', '松本実紗'];   // 会員から除外するスタッフ
var ONETRE_QUIT = ['河合正子'];              // ONE-TREで退会が確定している人（ヨシさん確認済みのみ）

// レンタルジムONE-TRE（長尾だけに見せる）。内容を直したいときはここを書き換える（検索ワード：RENTAL_INFO）
// 数字（会員数・今月の利用・月の売上）は、予約システムの集計とつなぐまで「-」のまま
var RENTAL_INFO = {
  name: 'レンタルジムONE-TRE',
  catch1: 'じぶんだけの時間',
  catch2: '自分に酔える場所',
  asOf: '2026/11/04',
  kpi: [ { label: '会員数', value: '-' }, { label: '今月の利用', value: '-' }, { label: '月の売上', value: '-' } ],
  breakeven: '月10万円（家賃・電気・借入返済）。通常6,600円なら16名で超えます。',
  terms: [
    ['モニター料金', '先着3名　月3,980円（アンケートに答える）'],
    ['通常料金', '月6,600円　使い放題'],
    ['退会手数料', '3,300円（登録したカードから引き落とし）'],
    ['利用時間', '月〜金 16〜22時 / 土 16〜20時　日祝は休み'],
    ['1回の利用', '60分　予約は1日1回まで'],
    ['2人で利用', '2人とも会員登録が必要'],
    ['禁止', '指導を仕事にする利用（違反は罰金33,000円）'],
    ['無断キャンセル', 'イエロー・レッドカードで段階的に罰則']
  ],
  progress: [
    ['済', '予約・入会・退会のページ'],
    ['済', 'QRでの来店の記録'],
    ['済', '月6,600円のStripe決済リンク'],
    ['済', '集計ダッシュボード（スプレッドシート）'],
    ['残', 'モニター3,980円のStripeリンクを作り、予約サイトの料金も直す'],
    ['残', 'モニターの条件に「顔なしの動画を広告に使う」を足す'],
    ['残', 'モニター3名を集める'],
    ['残', 'A4チラシ（3案）から1つ選ぶ']
  ]
};
// ===== 設定エリアここまで =====

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'getDashboard';
  try {
    if (action === 'getPrivate') {
      if (!tokenOk_(e.parameter.token)) return json_({ status: 'denied' });
      return json_({ status: 'ok', updated: new Date().toISOString(), data: buildPrivate_() });
    }
    // 誰でも見てよい数字（経費・利益・HAPPY KIDSは含めない）
    return json_({ status: 'ok', updated: new Date().toISOString(), data: publicOnly_(buildDashboard_()) });
  } catch (err) {
    return json_({ status: 'error', message: String(err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'login') return json_(login_(String(body.pw || '')));
    return json_({ status: 'error', message: 'unknown action' });
  } catch (err) {
    return json_({ status: 'error', message: String(err) });
  }
}

// ===== ログイン（長尾だけ）=====
var TOKEN_DAYS = 90;      // 一度ログインしたら、この端末では何日ログインのままにするか
var MAX_FAILS  = 5;       // 10分間にこの回数まちがえたら、いったんロック

function login_(pw) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('login_fails') || 0);
  if (fails >= MAX_FAILS) return { status: 'locked' };
  var real = PropertiesService.getScriptProperties().getProperty('OWNER_PASSWORD');
  if (!real) return { status: 'error', message: 'OWNER_PASSWORD が未設定です' };
  if (pw !== real) {
    cache.put('login_fails', String(fails + 1), 600);
    return { status: 'denied' };
  }
  cache.remove('login_fails');
  var token = Utilities.getUuid() + Utilities.getUuid();
  var props = PropertiesService.getScriptProperties();
  var all = JSON.parse(props.getProperty('TOKENS') || '{}');
  var now = Date.now();
  Object.keys(all).forEach(function (k) { if (all[k] < now) delete all[k]; });   // 期限切れを掃除
  all[token] = now + TOKEN_DAYS * 86400000;
  props.setProperty('TOKENS', JSON.stringify(all));
  return { status: 'ok', token: token };
}

function tokenOk_(token) {
  if (!token) return false;
  var all = JSON.parse(PropertiesService.getScriptProperties().getProperty('TOKENS') || '{}');
  return !!(all[token] && all[token] > Date.now());
}

// 全端末をログアウトさせたいときは、Apps Scriptでこの関数を1回実行する
function logoutAll() {
  PropertiesService.getScriptProperties().deleteProperty('TOKENS');
}

// 誰でも見てよい形にする：経費・今月の経費・HAPPY KIDSの数字を取り除く
function publicOnly_(d) {
  var out = JSON.parse(JSON.stringify(d));
  delete out.happykids;
  if (out.finance) {
    ['boxing', 'onetre', 'happykids', 'total'].forEach(function (k) {
      if (!out.finance[k]) return;
      delete out.finance[k].expense;
      delete out.finance[k].monthExpense;
    });
    delete out.finance.happykids;
  }
  return out;
}

// 長尾だけ：経費・利益・HAPPY KIDS・固定経費を足した全部
function buildPrivate_() {
  var ss = SpreadsheetApp.openById(LEDGER_ID);
  var exp = ss.getSheetByName('経費').getDataRange().getValues();
  var d = buildDashboard_();
  d.fixed = buildFixed_(ss, exp);
  d.rental = RENTAL_INFO;
  return d;
}

// ===== 固定経費（家賃・駐車場など。毎月自動で足す）=====
// 台帳スプレッドシートの「固定経費」シートを読む。列：名称／事業／金額／払い日／開始月(例 2026/11)／終了月(空欄＝続く)
// 台帳の「経費」に、同じ事業・同じ名称（例：家賃）が今月すでに記帳されていれば二重に足さない。
// 初回だけ、Apps Scriptで setupFixedCosts を1回実行するとシートができる。
function setupFixedCosts() {
  var ss = SpreadsheetApp.openById(LEDGER_ID);
  if (ss.getSheetByName('固定経費')) return;
  var sh = ss.insertSheet('固定経費');
  var ym = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM');
  sh.getRange(1, 1, 3, 6).setValues([
    ['名称', '事業', '金額', '払い日', '開始月', '終了月'],
    ['家賃', 'ワンバランスボクシングジム', 80000, 1, ym, ''],
    ['駐車場', 'ワンバランスボクシングジム', 20000, 1, ym, '']
  ]);
  sh.setFrozenRows(1);
}

function monthDiff_(a, b) { // 'yyyy/MM' どうしの差（b - a）
  var pa = a.split('/'), pb = b.split('/');
  return (Number(pb[0]) - Number(pa[0])) * 12 + (Number(pb[1]) - Number(pa[1]));
}

function buildFixed_(ss, exp) {
  var keys = { 'ワンバランスボクシングジム': 'boxing', 'ONE-TRE': 'onetre', 'HAPPY KIDS PROJECT': 'happykids' };
  var sh = ss.getSheetByName('固定経費');
  var out = { setup: !!sh, items: [], monthTotal: 0, byBiz: { boxing: 0, onetre: 0, happykids: 0 }, cumulativeByBiz: { boxing: 0, onetre: 0, happykids: 0 } };
  if (!sh) return out;
  var rows = sh.getDataRange().getValues();
  var now = new Date();
  var nowYm = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM');
  var today = Number(Utilities.formatDate(now, 'Asia/Tokyo', 'd'));
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var name = String(r[0] || '').trim();
    var key = keys[String(r[1] || '').trim()];
    var amount = toNum_(r[2]);
    var day = Math.max(1, Math.min(28, toNum_(r[3]) || 1));
    var start = ymOf_(r[4]), end = ymOf_(r[5]);
    if (!name || !key || !amount || !start) continue;
    var active = (start <= nowYm) && (!end || end >= nowYm);
    var recorded = false;                           // 台帳にすでに記帳済みか
    for (var j = 1; j < exp.length; j++) {
      var e = exp[j];
      if (keys[e[1]] === key && ymOf_(e[0]) === nowYm && String(e[3] || '').indexOf(name) >= 0) { recorded = true; break; }
    }
    var lastYm = (end && end < nowYm) ? end : nowYm;
    var months = Math.max(0, monthDiff_(start, lastYm) + 1);
    if (lastYm === nowYm && today < day) months = Math.max(0, months - 1);   // 払い日前の今月は数えない
    var monthAdd = (active && !recorded && today >= day) ? amount : 0;
    out.items.push({ name: name, biz: key, amount: amount, day: day, start: start, end: end || '', active: active, recorded: recorded, monthAdd: monthAdd, months: months });
    out.byBiz[key] += monthAdd;
    out.monthTotal += monthAdd;
    out.cumulativeByBiz[key] += amount * months;
  }
  return out;
}

function toNum_(v) {
  if (typeof v === 'number') return v;
  var s = String(v === null || v === undefined ? '' : v).replace(/[¥,円\s]/g, '');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function startsWith_(s, p) { return String(s || '').indexOf(p) === 0; }

function buildDashboard_() {
  var ss = SpreadsheetApp.openById(LEDGER_ID);
  var sales = ss.getSheetByName('売上').getDataRange().getValues();
  var exp   = ss.getSheetByName('経費').getDataRange().getValues();
  var kpi   = ss.getSheetByName('KPI').getDataRange().getValues();
  var avg   = ss.getSheetByName('KPI平均').getDataRange().getValues();

  var players = 0;
  try {
    var pl = SpreadsheetApp.openById(TAIKAI_ID).getSheetByName('選手申込み一覧').getDataRange().getValues();
    for (var i = 1; i < pl.length; i++) if (String(pl[i][1] || '').trim() !== '') players++;
  } catch (e1) { players = null; }

  var contracts = null;
  try {
    var ct = SpreadsheetApp.openById(PARTNER_ID).getSheetByName('パートナー契約一覧').getDataRange().getValues();
    contracts = { total: 0, active: 0, waiting: 0 };
    for (var j = 1; j < ct.length; j++) {
      if (String(ct[j][2] || '').trim() === '') continue;
      contracts.total++;
      if (ct[j][10] === '契約中') contracts.active++;
      if (ct[j][10] === '契約日待ち') contracts.waiting++;
    }
  } catch (e2) { contracts = null; }

  var out = compute_(sales, exp, kpi, avg, players, contracts);
  try { out.members = buildMembers_(); } catch (e3) { out.members = null; }
  try { out.finance = buildFinance_(sales, exp); } catch (e4) { out.finance = null; }
  return out;
}

function ymOf_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy/MM');
  var m = String(v || '').match(/(\d{4})[\/\-](\d{1,2})/);
  return m ? m[1] + '/' + ('0' + m[2]).slice(-2) : '';
}

// 事業別の売上・経費・利益（台帳「サマリー」と同じ計算：利益＝入金額の合計−経費合計）
function buildFinance_(sales, exp) {
  var keys = { 'ワンバランスボクシングジム': 'boxing', 'ONE-TRE': 'onetre', 'HAPPY KIDS PROJECT': 'happykids' };
  var nowYm = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM');
  function blank() { return { sales: 0, fee: 0, refund: 0, net: 0, expense: 0, monthSales: 0, monthNet: 0, monthExpense: 0 }; }
  var f = { boxing: blank(), onetre: blank(), happykids: blank(), total: blank(), month: nowYm };
  for (var i = 1; i < sales.length; i++) {
    var r = sales[i], k = keys[r[1]];
    if (!k || String(r[3] || '') === '') continue;
    var cur = (ymOf_(r[0]) === nowYm);
    [f[k], f.total].forEach(function (o) {
      o.sales += toNum_(r[4]); o.fee += toNum_(r[5]); o.refund += toNum_(r[6]); o.net += toNum_(r[7]);
      if (cur) { o.monthSales += toNum_(r[4]); o.monthNet += toNum_(r[7]); }
    });
  }
  for (var j = 1; j < exp.length; j++) {
    var e = exp[j], k2 = keys[e[1]];
    if (!k2) continue;
    var cur2 = (ymOf_(e[0]) === nowYm);
    [f[k2], f.total].forEach(function (o) {
      o.expense += toNum_(e[5]);
      if (cur2) o.monthExpense += toNum_(e[5]);
    });
  }
  return f;
}

function normName_(s) { return String(s || '').replace(/[\s\u3000]/g, ''); }
function genderKey_(g) { g = String(g || ''); return (g === '男性' || g === 'm' || g === 'M') ? 'm' : ((g === '女性' || g === 'f' || g === 'F') ? 'f' : 'x'); }

// 現在の会員数と、体験→成約の男女別（名前一致＝成約。スペース除く）
function buildMembers_() {
  var staff = {}; STAFF_NAMES.forEach(function (n) { staff[normName_(n)] = true; });

  // --- ボクシング ---
  var bx = SpreadsheetApp.openById(BOXING_MASTER_ID);
  var mm = bx.getSheetByName('会員マスタ').getDataRange().getValues();
  var h = mm[0], iN = h.indexOf('お名前'), iG = h.indexOf('性別'), iC = h.indexOf('コース'), iS = h.indexOf('状態');
  var bxNames = {}, bxActive = { total: 0, m: 0, f: 0, paused: 0 };
  for (var i = 1; i < mm.length; i++) {
    var r = mm[i]; if (!r[0] || !r[iN]) continue;
    var nm = normName_(r[iN]); if (staff[nm]) continue;
    bxNames[nm] = true;
    var st = String(r[iS]);
    if (st === '在籍' || st === '休会') {
      bxActive.total++;
      var gk = genderKey_(r[iG]); if (gk === 'm') bxActive.m++; else if (gk === 'f') bxActive.f++;
      if (st === '休会' || String(r[iC]).indexOf('休会') === 0) bxActive.paused++;
    }
  }
  var tf = bx.getSheetByName('体験者フォーム').getDataRange().getValues();
  var bxTrial = { m: { trial: 0, closed: 0 }, f: { trial: 0, closed: 0 } };
  for (var j = 1; j < tf.length; j++) {
    var t = tf[j]; if (!t[2]) continue;
    var k = genderKey_(t[3]); if (k === 'x') continue;
    bxTrial[k].trial++;
    if (bxNames[normName_(t[2])]) bxTrial[k].closed++;
  }

  // --- ONE-TRE ---
  var ot = SpreadsheetApp.openById(ONETRE_ID);
  var mem = ot.getSheetByName('会員').getDataRange().getValues();
  var quit = {}; ONETRE_QUIT.forEach(function (n) { quit[normName_(n)] = true; });
  var otNames = {}, otActive = { total: 0, m: 0, f: 0 };
  for (var a = 1; a < mem.length; a++) {
    var q = mem[a]; if (!q[1]) continue;
    var key = normName_(q[1]); if (staff[key] || otNames[key]) continue;
    otNames[key] = true;
    if (!quit[key]) { otActive.total++; var g2 = genderKey_(q[5]); if (g2 === 'm') otActive.m++; else if (g2 === 'f') otActive.f++; }
  }
  var tr = ot.getSheetByName('体験').getDataRange().getValues();
  var otTrial = { m: { trial: 0, closed: 0 }, f: { trial: 0, closed: 0 } };
  for (var b = 1; b < tr.length; b++) {
    var u = tr[b]; if (!u[1] || String(u[1]).trim() === 'テスト' || String(u[11]) !== '予約済み') continue;
    var k2 = genderKey_(u[2]); if (k2 === 'x') continue;
    otTrial[k2].trial++;
    if (otNames[normName_(u[1])]) otTrial[k2].closed++;
  }
  return { boxing: { active: bxActive, trial: bxTrial }, onetre: { active: otActive, trial: otTrial } };
}

// 計算部分（シートに依存しない）
function compute_(sales, exp, kpi, avg, players, contracts) {
  var BOX = 'ワンバランスボクシングジム', HK = 'HAPPY KIDS PROJECT';
  var sp = { count: 0, gross: 0, fee: 0, net: 0 };
  var partners = { count: 0, gross: 0, net: 0 };
  var surplus = 0, entryFeeCount = 0, hkNet = 0;
  for (var i = 1; i < sales.length; i++) {
    var r = sales[i];
    var proj = r[1], desc = String(r[3] || ''), refunded = (r[9] === '返金済み');
    if (!proj || desc === '') continue;
    if (proj === BOX && startsWith_(desc, '大会スポンサー') && !startsWith_(desc, '大会スポンサー余剰金') && !refunded) {
      sp.count++; sp.gross += toNum_(r[4]); sp.fee += toNum_(r[5]); sp.net += toNum_(r[7]);
    }
    if (proj === BOX && startsWith_(desc, 'ボクシング大会参加費') && !refunded) entryFeeCount++;
    if (proj === HK && startsWith_(desc, 'パートナーシップ年間') && !refunded) {
      partners.count++; partners.gross += toNum_(r[4]); partners.net += toNum_(r[7]); hkNet += toNum_(r[7]);
    }
    if (proj === HK && startsWith_(desc, 'パートナーシップ年間') && refunded) { hkNet += toNum_(r[7]); } // 返金済みでも戻らないカード手数料(マイナス)を台帳の利益と合わせる
    if (proj === HK && startsWith_(desc, '大会スポンサー余剰金')) { surplus += toNum_(r[4]); hkNet += toNum_(r[7]) || toNum_(r[4]); }
  }
  var taikaiCost = 0, hkCost = 0;
  for (var k = 1; k < exp.length; k++) {
    var e = exp[k];
    if (!e[1]) continue;
    if (e[1] === BOX && startsWith_(e[3], '大会運営費：')) taikaiCost += toNum_(e[5]);
    if (e[1] === HK) hkCost += toNum_(e[5]);
  }

  // KPI（月別）
  var rows = { boxing: [], onetre: [] };
  for (var m = 1; m < kpi.length; m++) {
    var x = kpi[m];
    if (!x[0] || !x[1]) continue;
    var d = (x[0] instanceof Date) ? x[0] : new Date(x[0]);
    var key = x[1] === BOX ? 'boxing' : (x[1] === 'ONE-TRE' ? 'onetre' : null);
    if (!key) continue;
    rows[key].push({
      year: d.getFullYear(), month: d.getMonth() + 1,
      trial: x[2] === '' ? null : toNum_(x[2]) + toNum_(x[12]),
      closed: x[3] === '' ? null : toNum_(x[3]) + toNum_(x[13]),
      rate: x[4] === '' ? null : toNum_(x[4]),
      newJoin: x[5] === '' ? null : toNum_(x[5]),
      renew: x[6] === '' ? null : toNum_(x[6]),
      quit: x[7] === '' ? null : toNum_(x[7]),
      note: String(x[11] || '')
    });
  }
  var avgOut = {};
  for (var a = 2; a < avg.length; a++) {
    avgOut[avg[a][0]] = { boxing: avg[a][1], onetre: avg[a][2] };
  }

  return {
    kpi: rows,
    avg: avgOut,
    happykids: {
      taikai: {
        sponsorCount: sp.count, sponsorGross: sp.gross, cardFee: sp.fee, sponsorNet: sp.net,
        cost: taikaiCost, surplus: sp.net - taikaiCost, surplusBooked: surplus,
        players: players, entryFeesInLedger: entryFeeCount
      },
      partners: { stripeCount: partners.count, stripeGross: partners.gross, contracts: contracts },
      hkSalesNet: hkNet, hkCost: hkCost, hkBalance: hkNet - hkCost
    }
  };
}
