/**
 * Athletic Club Management System
 * Google Apps Script Backend v3.0
 * 
 * SETUP:
 * 1. Open script.google.com → New Project
 * 2. Paste this code
 * 3. Deploy → New Deployment → Web App
 *    - Execute as: Me
 *    - Access: Anyone
 * 4. Copy Web App URL into attendance.html and accounting.html (GAS_URL constant)
 */

const SS_ID = ''; // 部活管理DB（自動作成）
const PHOTO_FOLDER_NAME = 'Athletic Club Photos';

// ── Google Forms 生徒リスト スプレッドシート ──
const FORMS_SHEET_ID  = '1Z2kHyKsq2VEMrOerwVOI8ncbtgg37poxxgTg_4F9ou4';
const FORMS_SHEET_GID = '2043636996';
// 列番号（A=1, F=6, G=7, I=9, T=20）
const COL_NAME     = 6;  // F列：氏名
const COL_FURIGANA = 7;  // G列：よみがな
const COL_GRADE    = 9;  // I列：学年
const COL_NFC      = 20; // T列：NFCカードID（後で入力）
// コース列は手入力後に追加予定

function doGet(e) {
  const action = e.parameter.action || '';
  let result;
  try {
    switch (action) {
      case 'getMembers':       result = getMembers(); break;
      case 'getMember':        result = getMember(e.parameter.id); break;
      case 'getPayments':      result = getPayments(e.parameter.memberId); break;
      case 'getAttendance':    result = getAttendance(e.parameter.date); break;
      case 'getSummary':       result = getSummary(e.parameter.month); break;
      case 'getSessions':      result = getSessions(); break;
      case 'getSession':       result = getSessionById(e.parameter.id); break;
      case 'getGroups':        result = getGroups(); break;
      case 'getPlayerHistory': result = getPlayerHistory(e.parameter.memberId); break;
      default:              result = { status: 'ok', message: 'Athletic Club API v3.0' };
    }
  } catch(err) { result = { status: 'error', message: err.message }; }
  return jsonResponse(result);
}

function doPost(e) {
  let data;
  try { data = JSON.parse(e.postData.contents); }
  catch(err) { return jsonResponse({ status: 'error', message: 'Invalid JSON' }); }
  let result;
  try {
    switch (data.action) {
      case 'attendance':      result = recordAttendance(data); break;
      case 'coachAttendance': result = recordCoachAttendance(data); break;
      case 'payment':         result = recordPayment(data); break;
      case 'registerMember':  result = registerMember(data); break;
      case 'uploadPhoto':     result = uploadPhoto(data); break;
      case 'saveSession':     result = saveSession(data); break;
      case 'saveGroup':       result = saveGroup(data); break;
      case 'deleteSession':   result = deleteSession(data); break;
      default:               result = { status: 'error', message: 'Unknown: ' + data.action };
    }
  } catch(err) { result = { status: 'error', message: err.message }; }
  return jsonResponse(result);
}

function getSpreadsheet() {
  if (SS_ID) return SpreadsheetApp.openById(SS_ID);
  const files = DriveApp.getFilesByName('Athletic Club Database');
  if (files.hasNext()) return SpreadsheetApp.open(files.next());
  const ss = SpreadsheetApp.create('Athletic Club Database');
  initSheets(ss);
  return ss;
}

function getSheet(name) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) { sheet = ss.insertSheet(name); initSheet(sheet, name); }
  return sheet;
}

function initSheets(ss) {
  const names = ['Members','Payments','Attendance','CoachAttendance','Photos','PerfSessions','PerfEntries','PerfGroups'];
  const first = ss.getSheets()[0]; first.setName(names[0]); initSheet(first, names[0]);
  for (let i=1; i<names.length; i++) { const s = ss.insertSheet(names[i]); initSheet(s, names[i]); }
}

function initSheet(sheet, name) {
  const headers = {
    Members:         ['id','name','furigana','course','fee','phone','email','joinDate','nfcId','assocFee','insurance','active','createdAt'],
    Payments:        ['id','nfcId','memberId','memberName','type','months','interval','amount','method','staff','note','photoIds','date','createdAt'],
    Attendance:      ['id','nfcId','memberId','memberName','class','date','time','createdAt'],
    CoachAttendance: ['id','coachId','coachName','slot','reward','date','time','createdAt'],
    Photos:          ['id','paymentId','driveFileId','driveUrl','filename','createdAt'],
    PerfSessions:    ['id','date','eventName','note','photoUrls','avgTime','bestTime','worstTime','participantCount','createdAt'],
    PerfEntries:     ['id','sessionId','memberId','memberName','grade','time','relative','relToAvg','gradeRelative','memo','createdAt'],
    PerfGroups:      ['id','groupName','sessionIds','note','createdAt'],
  };
  if (headers[name]) {
    sheet.getRange(1,1,1,headers[name].length).setValues([headers[name]]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function getMembers() {
  try {
    // Google Forms スプレッドシートから生徒リストを取得
    const ss = SpreadsheetApp.openById(FORMS_SHEET_ID);
    // gidでシートを特定
    const sheets = ss.getSheets();
    let sheet = sheets.find(s => String(s.getSheetId()) === FORMS_SHEET_GID);
    if (!sheet) sheet = sheets[0]; // fallback

    const rows = sheet.getDataRange().getValues();
    const members = [];

    for (let i = 1; i < rows.length; i++) { // 1行目はヘッダーなのでスキップ
      const row = rows[i];
      const name = row[COL_NAME - 1];
      if (!name) continue; // 名前が空の行はスキップ

      const nfcId = row[COL_NFC - 1] || '';
      members.push({
        id:       nfcId || 'ROW' + i,  // NFCIDがあればそれ、なければ行番号で識別
        nfcId:    nfcId,
        name:     String(name),
        furigana: String(row[COL_FURIGANA - 1] || ''),
        grade:    String(row[COL_GRADE - 1] || ''),
        course:   '',    // 後日追加
        fee:      0,     // 後日追加
        paidMonths: [],  // Paymentsシートから別途取得
        assocFee:   false,
        insurance:  false,
      });
    }

    return { status: 'ok', members, source: 'forms', count: members.length };
  } catch(e) {
    // Formsシートが読めない場合は管理DBのMembersシートを返す
    return { status: 'ok', members: sheetToObjects(getSheet('Members')).filter(m => m.active !== 'false'), source: 'db' };
  }
}

function getMember(id) {
  const member = sheetToObjects(getSheet('Members')).find(m=>m.nfcId===id||m.id===id);
  if (!member) return { status:'notFound', message:'会員が見つかりません' };
  const payData = sheetToObjects(getSheet('Payments')).filter(p=>p.nfcId===id||p.memberId===member.id);
  const paidMonths = [];
  payData.filter(p=>p.type==='月謝').forEach(p=>{
    if(p.months) p.months.split(',').map(m=>m.trim()).forEach(m=>{if(m&&!paidMonths.includes(m))paidMonths.push(m);});
  });
  return { status:'ok', member:{...member, paidMonths} };
}

function registerMember(data) {
  const sheet = getSheet('Members');
  const id = 'M'+Date.now();
  sheet.appendRow([id,data.name||'',data.furigana||'',data.course||'',data.fee||0,
    data.phone||'',data.email||'',data.joinDate||new Date().toISOString().slice(0,10),
    data.nfcId||'','true','false','true',new Date().toISOString()]);
  return { status:'ok', id };
}

function getPayments(memberId) {
  const data = sheetToObjects(getSheet('Payments'));
  return { status:'ok', payments: memberId ? data.filter(p=>p.memberId===memberId||p.nfcId===memberId) : data };
}

function recordPayment(data) {
  const id = 'P'+Date.now();
  let photoIds = '';
  if (data.photos && data.photos.length) {
    const ids = [];
    data.photos.forEach((p,i)=>{ const r=uploadPhotoToDrive(p,id,i); if(r.fileId) ids.push(r.fileId); });
    photoIds = ids.join(',');
  }
  getSheet('Payments').appendRow([id,data.nfcId||'',data.memberId||'',data.memberName||'',
    data.type||'月謝',Array.isArray(data.months)?data.months.join(','):(data.months||''),
    data.interval||1,data.amount||0,data.method||'現金',data.staff||'',
    data.note||'',photoIds,data.date||new Date().toISOString().slice(0,10),new Date().toISOString()]);
  return { status:'ok', id, photoIds };
}

function getAttendance(date) {
  const today = date||new Date().toISOString().slice(0,10);
  return { status:'ok', attendance: sheetToObjects(getSheet('Attendance')).filter(a=>a.date===today), date:today };
}

function recordCoachAttendance(data) {
  const id = 'CA' + Date.now();
  const now = new Date();
  const date = data.date || now.toISOString().slice(0, 10);
  const time = data.time || `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  getSheet('CoachAttendance').appendRow([
    id, data.coachId || '', data.coachName || '',
    data.slot || '', data.reward ? 'TRUE' : 'FALSE',
    date, time, now.toISOString()
  ]);
  return { status: 'ok', id };
}

function recordAttendance(data) {
  const id = 'A'+Date.now(); const now = new Date();
  const date = now.toISOString().slice(0,10);
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  getSheet('Attendance').appendRow([id,data.nfcId||'',data.memberId||'',data.memberName||'',
    data.class||'通常',date,time,now.toISOString()]);
  return { status:'ok', id };
}

function getOrCreatePhotoFolder() {
  const f = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  return f.hasNext() ? f.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
}

function uploadPhotoToDrive(base64Data, paymentId, index) {
  try {
    const match = base64Data.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
    if (!match) return { error:'Invalid format' };
    const blob = Utilities.newBlob(Utilities.base64Decode(match[2]),'image/'+match[1],`receipt_${paymentId}_${index+1}.jpg`);
    const today = new Date().toISOString().slice(0,7);
    const parent = getOrCreatePhotoFolder();
    const subs = parent.getFoldersByName(today);
    const sub = subs.hasNext() ? subs.next() : parent.createFolder(today);
    const file = sub.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const photoId = 'IMG'+Date.now()+'_'+index;
    getSheet('Photos').appendRow([photoId,paymentId,file.getId(),file.getUrl(),file.getName(),new Date().toISOString()]);
    return { fileId: file.getId(), url: file.getUrl() };
  } catch(e) { return { error: e.message }; }
}

function uploadPhoto(data) {
  if (!data.base64||!data.paymentId) return { status:'error', message:'Missing data' };
  const r = uploadPhotoToDrive(data.base64, data.paymentId, data.index||0);
  return r.error ? { status:'error', message:r.error } : { status:'ok', fileId:r.fileId, url:r.url };
}

function getSummary(month) {
  const now = new Date();
  const target = month||`${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}`;
  const payments = sheetToObjects(getSheet('Payments'));
  const members = sheetToObjects(getSheet('Members')).filter(m=>m.active!=='false');
  const monthlyTuition = payments.filter(p=>p.type==='月謝'&&p.months&&p.months.split(',').map(m=>m.trim()).includes(target)).reduce((s,p)=>s+(parseFloat(p.amount)||0),0);
  const cumTuition = payments.filter(p=>p.type==='月謝').reduce((s,p)=>s+(parseFloat(p.amount)||0),0);
  const allTotal = payments.reduce((s,p)=>s+(parseFloat(p.amount)||0),0);
  const paid = new Set();
  payments.filter(p=>p.type==='月謝'&&p.months&&p.months.split(',').includes(target)).forEach(p=>paid.add(p.nfcId||p.memberId));
  const unpaid = members.filter(m=>!paid.has(m.nfcId)&&!paid.has(m.id));
  const trend = [];
  for (let i=5;i>=0;i--) {
    const d = new Date(now.getFullYear(),now.getMonth()-i,1);
    const k = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}`;
    trend.push({month:k,amount:payments.filter(p=>p.type==='月謝'&&p.months&&p.months.split(',').map(m=>m.trim()).includes(k)).reduce((s,p)=>s+(parseFloat(p.amount)||0),0)});
  }
  return { status:'ok', target, monthlyTuition, cumTuition, allTotal, unpaidCount:unpaid.length, unpaidMembers:unpaid.map(m=>({id:m.id,nfcId:m.nfcId,name:m.name,course:m.course})), trend };
}

// ══════════════════════════════════════════
// ── PERFORMANCE TRACKING ──
// ══════════════════════════════════════════

function getSessions() {
  const sessions = sheetToObjects(getSheet('PerfSessions'));
  const entries  = sheetToObjects(getSheet('PerfEntries'));
  // 各セッションにentriesを付与
  sessions.forEach(s => {
    s.entries = entries.filter(e => e.sessionId === s.id);
  });
  return { status:'ok', sessions: sessions.reverse() };
}

function getSessionById(id) {
  const sessions = sheetToObjects(getSheet('PerfSessions'));
  const s = sessions.find(x => x.id === id);
  if (!s) return { status:'notFound' };
  s.entries = sheetToObjects(getSheet('PerfEntries')).filter(e => e.sessionId === id);
  return { status:'ok', session: s };
}

function saveSession(data) {
  const id = 'SESS' + Date.now();
  const now = new Date().toISOString();

  // コース写真をDriveにアップロード
  const photoUrls = [];
  if (data.photos && data.photos.length) {
    const folder = getOrCreatePhotoFolder();
    const sub = getOrCreateSubFolder(folder, 'performance/' + (data.date || id));
    data.photos.forEach((b64, i) => {
      try {
        const match = b64.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
        if (!match) return;
        const blob = Utilities.newBlob(Utilities.base64Decode(match[2]), 'image/'+match[1], `course_${id}_${i+1}.jpg`);
        const file = sub.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        photoUrls.push(file.getUrl());
      } catch(e) {}
    });
  }

  // セッション統計
  const times = (data.entries || []).map(e => parseFloat(e.time)).filter(t => t > 0);
  const avg  = times.length ? times.reduce((a,b)=>a+b,0)/times.length : 0;
  const best  = times.length ? Math.min(...times) : 0;
  const worst = times.length ? Math.max(...times) : 0;

  getSheet('PerfSessions').appendRow([
    id, data.date||'', data.eventName||'', data.note||'',
    photoUrls.join(','), avg.toFixed(3), best.toFixed(3), worst.toFixed(3),
    times.length, now
  ]);

  // エントリー保存
  const sheet = getSheet('PerfEntries');
  (data.entries || []).forEach(e => {
    if (!e.time || parseFloat(e.time) <= 0) return;
    sheet.appendRow([
      'E'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
      id, e.memberId||'', e.memberName||'', e.grade||'',
      parseFloat(e.time), e.relative||0, e.relToAvg||0, e.gradeRelative||0,
      e.memo||'', now
    ]);
  });

  return { status:'ok', id, photoUrls };
}

function getGroups() {
  return { status:'ok', groups: sheetToObjects(getSheet('PerfGroups')) };
}

function saveGroup(data) {
  const existing = sheetToObjects(getSheet('PerfGroups'));
  const found = existing.find(g => g.id === data.id);
  const sheet = getSheet('PerfGroups');

  if (found) {
    // 更新: sessionIdsを上書き
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === data.id) {
        sheet.getRange(i+1, 2).setValue(data.groupName || found.groupName);
        sheet.getRange(i+1, 3).setValue(Array.isArray(data.sessionIds) ? data.sessionIds.join(',') : data.sessionIds);
        sheet.getRange(i+1, 4).setValue(data.note || '');
        break;
      }
    }
    return { status:'ok', id: data.id };
  }

  const id = 'GRP' + Date.now();
  sheet.appendRow([
    id, data.groupName||'グループ1',
    Array.isArray(data.sessionIds) ? data.sessionIds.join(',') : (data.sessionIds||''),
    data.note||'', new Date().toISOString()
  ]);
  return { status:'ok', id };
}

function deleteSession(data) {
  // PerfSessionsから削除
  const sSheet = getSheet('PerfSessions');
  const sRows = sSheet.getDataRange().getValues();
  for (let i = sRows.length - 1; i >= 1; i--) {
    if (sRows[i][0] === data.id) { sSheet.deleteRow(i+1); break; }
  }
  // PerfEntriesから削除
  const eSheet = getSheet('PerfEntries');
  const eRows = eSheet.getDataRange().getValues();
  for (let i = eRows.length - 1; i >= 1; i--) {
    if (eRows[i][1] === data.id) eSheet.deleteRow(i+1);
  }
  return { status:'ok' };
}

function getPlayerHistory(memberId) {
  const entries = sheetToObjects(getSheet('PerfEntries')).filter(e => e.memberId === memberId);
  const sessions = sheetToObjects(getSheet('PerfSessions'));
  const result = entries.map(e => {
    const s = sessions.find(x => x.id === e.sessionId);
    return { ...e, date: s ? s.date : '', eventName: s ? s.eventName : '' };
  }).sort((a,b) => a.date.localeCompare(b.date));
  return { status:'ok', history: result };
}

function getOrCreateSubFolder(parent, path) {
  const parts = path.split('/');
  let current = parent;
  parts.forEach(p => {
    const found = current.getFoldersByName(p);
    current = found.hasNext() ? found.next() : current.createFolder(p);
  });
  return current;
}

// ══════════════════════════════════════════

function sheetToObjects(sheet) {
  const rows = sheet.getDataRange().getValues();
  if (rows.length<2) return [];
  const h = rows[0];
  return rows.slice(1).map(r=>{ const o={}; h.forEach((k,i)=>o[k]=r[i]); return o; });
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🏃 Athletic Club')
    .addItem('シートを初期化','setupSheets')
    .addItem('今月の集計','showMonthlySummary')
    .addToUi();
}

function setupSheets() { initSheets(getSpreadsheet()); SpreadsheetApp.getUi().alert('完了 ✓'); }

function showMonthlySummary() {
  const r = getSummary();
  SpreadsheetApp.getUi().alert(`今月 (${r.target})\n月謝: ¥${r.monthlyTuition.toLocaleString()}\n累計: ¥${r.cumTuition.toLocaleString()}\n未払い: ${r.unpaidCount}名`);
}
