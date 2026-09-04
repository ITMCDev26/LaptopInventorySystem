/**
 * LAPTOP ASSET MANAGER — API BACKEND
 * Deploy this as a Google Apps Script Web App. It exposes a JSON API
 * (POST with {action, token, payload}) that a separate static HTML/CSS/JS
 * site calls with fetch(). All data lives in this spreadsheet's tabs:
 * Users, Laptops, History.
 */

const SHEET_LAPTOPS = 'Laptops';
const SHEET_HISTORY = 'History';
const SHEET_USERS = 'Users';
const TOKEN_TTL_SECONDS = 6 * 60 * 60; // 6 hour session
const LAPTOP_LIFESPAN_YEARS = 5;

function getSS() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

// ============================================================
// API ENTRY POINTS
// ============================================================
function doGet(e) {
  return jsonResponse({ ok: true, message: 'Laptop Asset Manager API is running.' });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ ok: false, error: 'Invalid request body.' });
  }

  const action = body.action;
  const token = body.token;
  const payload = body.payload || {};

  try {
    let result;
    switch (action) {
      case 'login': result = login(payload.username, payload.password); break;
      case 'logout': result = logout(token); break;
      case 'getDashboardStats': result = getDashboardStats(token); break;
      case 'registerLaptop': result = registerLaptop(token, payload); break;
      case 'transferLaptop': result = transferLaptop(token, payload); break;
      case 'assignPendingLaptop': result = assignPendingLaptop(token, payload); break;
      case 'searchBySerial': result = searchBySerial(token, payload.query); break;
      case 'searchByEmployee': result = searchByEmployee(token, payload.query); break;
      case 'getAllLaptops': result = getAllLaptops(token); break;
      default: throw new Error('Unknown action: ' + action);
    }
    return jsonResponse({ ok: true, data: result });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// ONE-TIME SETUP — run manually from the Apps Script editor
// (select setupSheets in the function dropdown, then Run)
// ============================================================
function setupSheets() {
  const ss = getSS();

  if (!ss.getSheetByName(SHEET_USERS)) {
    const sh = ss.insertSheet(SHEET_USERS);
    sh.appendRow(['Username', 'PasswordHash', 'FullName', 'Role', 'DateCreated']);
    sh.appendRow(['admin', hashPassword('admin123'), 'System Administrator', 'admin', new Date()]);
    sh.getRange(1, 1, 1, 5).setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  if (!ss.getSheetByName(SHEET_LAPTOPS)) {
    const sh = ss.insertSheet(SHEET_LAPTOPS);
    sh.appendRow(['ControlNumber', 'SerialNo', 'Brand', 'Model', 'PONumber', 'DatePurchased',
      'AccountableEmployee', 'EmployeeNo', 'TownshipUnit', 'Status', 'Remarks', 'DateRegistered']);
    sh.getRange(1, 1, 1, 12).setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  if (!ss.getSheetByName(SHEET_HISTORY)) {
    const sh = ss.insertSheet(SHEET_HISTORY);
    sh.appendRow(['Timestamp', 'SerialNo', 'ControlNumber', 'FromEmployee', 'FromEmployeeNo',
      'ToEmployee', 'ToEmployeeNo', 'TownshipUnit', 'Reason', 'Remarks', 'ProcessedBy']);
    sh.getRange(1, 1, 1, 11).setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  SpreadsheetApp.getUi().alert(
    'Setup complete.\n\nDefault login:\nUsername: admin\nPassword: admin123\n\nPlease log in and change this password (Users sheet) before real use.'
  );
}

// ============================================================
// AUTH
// ============================================================
function hashPassword(pw) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pw);
  return digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

function login(username, password) {
  const sh = getSS().getSheetByName(SHEET_USERS);
  const data = sh.getDataRange().getValues();
  const hash = hashPassword(password || '');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === String(username).toLowerCase() && data[i][1] === hash) {
      const token = Utilities.getUuid();
      CacheService.getScriptCache().put(
        'token_' + token,
        JSON.stringify({ username: data[i][0], fullName: data[i][2], role: data[i][3] }),
        TOKEN_TTL_SECONDS
      );
      return { success: true, token: token, fullName: data[i][2], role: data[i][3] };
    }
  }
  return { success: false, message: 'Invalid username or password.' };
}

function validateToken(token) {
  if (!token) return null;
  const val = CacheService.getScriptCache().get('token_' + token);
  return val ? JSON.parse(val) : null;
}

function requireAuth(token) {
  const user = validateToken(token);
  if (!user) throw new Error('SESSION_EXPIRED');
  return user;
}

function logout(token) {
  CacheService.getScriptCache().remove('token_' + token);
  return { success: true };
}

// ============================================================
// DASHBOARD
// ============================================================
function getDashboardStats(token) {
  requireAuth(token);
  const sh = getSS().getSheetByName(SHEET_LAPTOPS);
  const rows = sh.getDataRange().getValues().slice(1);

  const total = rows.length;
  const active = rows.filter(r => r[9] === 'Active').length;
  const pending = rows.filter(r => r[9] === 'Pending Reassignment').length;
  const retired = rows.filter(r => r[9] === 'Retired').length;

  const brandCounts = {};
  rows.forEach(r => {
    const b = r[2] || 'Unknown';
    brandCounts[b] = (brandCounts[b] || 0) + 1;
  });

  const now = new Date();
  let agingSoon = 0;
  rows.forEach(r => {
    if (r[5]) {
      const purchased = new Date(r[5]);
      const years = (now - purchased) / (1000 * 60 * 60 * 24 * 365.25);
      if (years >= LAPTOP_LIFESPAN_YEARS - 0.5) agingSoon++;
    }
  });

  const histSh = getSS().getSheetByName(SHEET_HISTORY);
  const histRows = histSh.getDataRange().getValues().slice(1);
  const recentTransfers = histRows.slice(-8).reverse().map(r => ({
    timestamp: r[0], serialNo: r[1], controlNumber: r[2],
    fromEmployee: r[3], toEmployee: r[5], reason: r[8]
  }));

  return { total, active, pending, retired, agingSoon, brandCounts, recentTransfers };
}

// ============================================================
// REGISTER NEW LAPTOP
// ============================================================
function registerLaptop(token, d) {
  const user = requireAuth(token);
  const sh = getSS().getSheetByName(SHEET_LAPTOPS);
  const data = sh.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase() === String(d.serialNo).toLowerCase()) {
      throw new Error('A laptop with this serial number is already registered.');
    }
  }

  sh.appendRow([
    d.controlNumber, d.serialNo, d.brand, d.model || '', d.poNumber, d.datePurchased,
    d.accountableEmployee, d.employeeNo, d.townshipUnit, 'Active', d.remarks || '', new Date()
  ]);

  getSS().getSheetByName(SHEET_HISTORY).appendRow([
    new Date(), d.serialNo, d.controlNumber, '', '', d.accountableEmployee, d.employeeNo,
    d.townshipUnit, 'New Registration', d.remarks || '', user.fullName
  ]);

  return { success: true };
}

// ============================================================
// TRANSFER LAPTOP (reason: 'New Assignment' or 'Resigned')
// ============================================================
function transferLaptop(token, d) {
  const user = requireAuth(token);
  const sh = getSS().getSheetByName(SHEET_LAPTOPS);
  const data = sh.getDataRange().getValues();

  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase() === String(d.serialNo).toLowerCase()) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) throw new Error('No laptop found with that serial or control number.');

  const record = sh.getRange(rowIndex, 1, 1, 12).getValues()[0];
  const oldEmployee = record[6];
  const oldEmployeeNo = record[7];

  const isResign = d.reason === 'Resigned';
  const newStatus = isResign ? 'Pending Reassignment' : 'Active';
  const newOwner = isResign ? '' : d.toEmployee;
  const newOwnerNo = isResign ? '' : d.toEmployeeNo;
  const newUnit = isResign ? record[8] : (d.townshipUnit || record[8]);

  sh.getRange(rowIndex, 7).setValue(newOwner);
  sh.getRange(rowIndex, 8).setValue(newOwnerNo);
  sh.getRange(rowIndex, 9).setValue(newUnit);
  sh.getRange(rowIndex, 10).setValue(newStatus);
  if (d.remarks) sh.getRange(rowIndex, 11).setValue(d.remarks);

  getSS().getSheetByName(SHEET_HISTORY).appendRow([
    new Date(), d.serialNo, record[0], oldEmployee, oldEmployeeNo,
    newOwner, newOwnerNo, newUnit, d.reason, d.remarks || '', user.fullName
  ]);

  return {
    success: true,
    clearance: isResign ? {
      employee: oldEmployee, employeeNo: oldEmployeeNo, serialNo: d.serialNo,
      controlNumber: record[0], brand: record[2], model: record[3],
      date: new Date().toString(), processedBy: user.fullName
    } : null
  };
}

// Reassign a laptop sitting in "Pending Reassignment" to a new employee
function assignPendingLaptop(token, d) {
  const user = requireAuth(token);
  const sh = getSS().getSheetByName(SHEET_LAPTOPS);
  const data = sh.getDataRange().getValues();

  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase() === String(d.serialNo).toLowerCase()) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) throw new Error('Laptop not found.');
  const record = sh.getRange(rowIndex, 1, 1, 12).getValues()[0];

  sh.getRange(rowIndex, 7).setValue(d.toEmployee);
  sh.getRange(rowIndex, 8).setValue(d.toEmployeeNo);
  sh.getRange(rowIndex, 9).setValue(d.townshipUnit || record[8]);
  sh.getRange(rowIndex, 10).setValue('Active');

  getSS().getSheetByName(SHEET_HISTORY).appendRow([
    new Date(), d.serialNo, record[0], '', '', d.toEmployee, d.toEmployeeNo,
    d.townshipUnit || record[8], 'New Assignment', d.remarks || '', user.fullName
  ]);

  return { success: true };
}

// ============================================================
// SEARCH
// ============================================================
function searchBySerial(token, serial) {
  requireAuth(token);
  const sh = getSS().getSheetByName(SHEET_LAPTOPS);
  const data = sh.getDataRange().getValues();
  let laptop = null;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase() === String(serial).toLowerCase() ||
        String(data[i][0]).toLowerCase() === String(serial).toLowerCase()) {
      laptop = {
        controlNumber: data[i][0], serialNo: data[i][1], brand: data[i][2], model: data[i][3],
        poNumber: data[i][4], datePurchased: data[i][5], accountableEmployee: data[i][6],
        employeeNo: data[i][7], townshipUnit: data[i][8], status: data[i][9],
        remarks: data[i][10], dateRegistered: data[i][11]
      };
      break;
    }
  }
  if (!laptop) return { laptop: null, history: [] };

  const histData = getSS().getSheetByName(SHEET_HISTORY).getDataRange().getValues();
  const history = [];
  for (let i = 1; i < histData.length; i++) {
    if (String(histData[i][1]).toLowerCase() === String(laptop.serialNo).toLowerCase()) {
      history.push({
        timestamp: histData[i][0], fromEmployee: histData[i][3], fromEmployeeNo: histData[i][4],
        toEmployee: histData[i][5], toEmployeeNo: histData[i][6], townshipUnit: histData[i][7],
        reason: histData[i][8], remarks: histData[i][9], processedBy: histData[i][10]
      });
    }
  }
  history.reverse();
  return { laptop, history };
}

function searchByEmployee(token, employeeNo) {
  requireAuth(token);
  const sh = getSS().getSheetByName(SHEET_LAPTOPS);
  const data = sh.getDataRange().getValues();
  const laptops = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][7]).toLowerCase() === String(employeeNo).toLowerCase()) {
      laptops.push({
        controlNumber: data[i][0], serialNo: data[i][1], brand: data[i][2], model: data[i][3],
        accountableEmployee: data[i][6], employeeNo: data[i][7], townshipUnit: data[i][8],
        status: data[i][9], datePurchased: data[i][5]
      });
    }
  }
  return laptops;
}

function getAllLaptops(token) {
  requireAuth(token);
  const sh = getSS().getSheetByName(SHEET_LAPTOPS);
  const data = sh.getDataRange().getValues();
  const laptops = [];
  for (let i = 1; i < data.length; i++) {
    laptops.push({
      controlNumber: data[i][0], serialNo: data[i][1], brand: data[i][2], model: data[i][3],
      poNumber: data[i][4], datePurchased: data[i][5], accountableEmployee: data[i][6],
      employeeNo: data[i][7], townshipUnit: data[i][8], status: data[i][9], remarks: data[i][10]
    });
  }
  return laptops;
}
