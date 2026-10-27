/**
 * ONE-BALANCE 経営ダッシュボード用API（読み取り専用）
 * 台帳（事務部隊_経理台帳）などから数字だけを返す。経費の明細は返さない（合計のみ）。
 * 使い方：ウェブアプリとして公開（実行：自分／アクセス：全員）→ URL末尾に ?action=getDashboard
 */
var LEDGER_ID  = '1UB2GAO_-aX7SE7t9l4tNAsJJr7NhpzTCMcgYO_AZ9TM'; // 事務部隊_経理台帳
var TAIKAI_ID  = '18TPuqVVVbO7Fbc1pL6XheeXuFtLVdXe0agpQRNXeFr0'; // 2026大会&スポンサー
var PARTNER_ID = '13BOp0lg7tFE4ZpkeJspsa9fc9YkdYZeHGxLf1ZhrQc4'; // HAPPY KIDS PROJECT パートナー契約・更新管理
var BOXING_MASTER_ID = '1J-bu8590Snq--Xtf76wsYemK_SYCO_5KlObjM03r2BM'; // ワンバランス会員マスタ（会員マスタ／体験者フォーム）
var ONETRE_ID = '1LYNNK1_gY3UvrAGgErfOmR00lXsigZYry8RWeBIUWKk';         // パーソナルONE-TRE申込み（回答）（会員／体験）

// ===== 設定エリア（検索ワード：DASH_CONFIG）=====
var STAFF_NAMES = ['長尾儀弘', '松本実紗'];   // 会員から除外するスタッフ
var ONETRE_QUIT = ['河合正子'];              // ONE-TREで退会が確定している人（ヨシさん確認済みのみ）
// ===== 設定エリアここまで =====

function doGet(e) {
  var out;
  try {
    out = { status: 'ok', updated: new Date().toISOString(), data: buildDashboard_() };
  } catch (err) {
    out = { status: 'error', message: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
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
  return out;
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
