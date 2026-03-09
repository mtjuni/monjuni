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

const SS_ID = ''; // Leave blank to auto-create, or paste your Spreadsheet ID
const PHOTO_FOLDER_NAME = 'Athletic Club Photos';

function doGet(e) {
  const action = e.parameter.action || '';
  let result;
  try {
    switch (action) {
      case 'getMembers':    result = getMembers(); break;
      case 'getMember':     result = getMember(e.parameter.id); break;
      case 'getPayments':   result = getPayments(e.parameter.memberId); break;
      case 'getAttendance': result = getAttendance(e.parameter.date); break;
      case 'getSummary':    result = getSummary(e.parameter.month); break;
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
      case 'attendance':     result = recordAttendance(data); break;
      case 'payment':        result = recordPayment(data); break;
      case 'registerMember': result = registerMember(data); break;
      case 'uploadPhoto':    result = uploadPhoto(data); break;
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
  const names = ['Members','Payments','Attendance','Photos'];
  const first = ss.getSheets()[0]; first.setName(names[0]); initSheet(first, names[0]);
  for (let i=1; i<names.length; i++) { const s = ss.insertSheet(names[i]); initSheet(s, names[i]); }
}

function initSheet(sheet, name) {
  const headers = {
    Members:    ['id','name','furigana','course','fee','phone','email','joinDate','nfcId','assocFee','insurance','active','createdAt'],
    Payments:   ['id','nfcId','memberId','memberName','type','months','interval','amount','method','staff','note','photoIds','date','createdAt'],
    Attendance: ['id','nfcId','memberId','memberName','class','date','time','createdAt'],
    Photos:     ['id','paymentId','driveFileId','driveUrl','filename','createdAt'],
  };
  if (headers[name]) {
    sheet.getRange(1,1,1,headers[name].length).setValues([headers[name]]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function getMembers() {
  return { status:'ok', members: sheetToObjects(getSheet('Members')).filter(m=>m.active!=='false') };
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
