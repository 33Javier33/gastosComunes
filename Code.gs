/**
 * SpendSync – Google Apps Script Backend
 *
 * DEPLOY INSTRUCTIONS:
 *  1. Go to https://script.google.com and create a new project.
 *  2. Paste this entire file into the editor (replacing the default code).
 *  3. Click "Deploy" → "New deployment" → Type: "Web app".
 *  4. Set "Execute as" = Me, "Who has access" = Anyone (or Anyone with link).
 *  5. Click Deploy → copy the Web App URL (already wired inside index.js).
 *
 * SHEET STRUCTURE (auto-created on first run):
 *  Sheet "expenses"  columns: id | type | date | concept | amount | paidBy | updatedAt
 *  Sheet "meta"      columns: key | value
 *    meta row "authData" stores the full user config as a JSON string so any
 *    browser can load names/PINs/RUTs without going through setup again.
 */

const SHEET_NAME_EXPENSES = 'expenses';
const SHEET_NAME_META      = 'meta';
const EXPENSE_HEADERS      = ['id', 'type', 'date', 'concept', 'amount', 'paidBy', 'updatedAt'];

// ─── ENTRY POINTS ─────────────────────────────────────────────────────────────

function doGet(e) {
    try {
        const action = (e && e.parameter && e.parameter.action) || 'pull';
        if (action === 'pull') {
            return jsonResponse({
                ok: true,
                expenses: readExpenses(),
                authData: readAuthData()   // null if not yet set
            });
        }
        return jsonResponse({ ok: false, error: 'Unknown action' });
    } catch (err) {
        return jsonResponse({ ok: false, error: err.message });
    }
}

function doPost(e) {
    try {
        const body   = JSON.parse(e.postData.contents);
        const action = body.action || 'push';

        if (action === 'push') {
            writeExpenses(body.expenses || []);
            if (body.authData) saveAuthData(body.authData);
            return jsonResponse({ ok: true, written: (body.expenses || []).length });
        }
        return jsonResponse({ ok: false, error: 'Unknown action' });
    } catch (err) {
        return jsonResponse({ ok: false, error: err.message });
    }
}

// ─── READ EXPENSES ────────────────────────────────────────────────────────────

function readExpenses() {
    const sheet = getOrCreateSheet(SHEET_NAME_EXPENSES, EXPENSE_HEADERS);
    const rows  = sheet.getDataRange().getValues();
    if (rows.length <= 1) return [];

    const headers = rows[0];
    return rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i]; });
        obj.amount = Number(obj.amount) || 0;
        return obj;
    });
}

// ─── WRITE EXPENSES (upsert by id) ────────────────────────────────────────────

function writeExpenses(incoming) {
    if (!incoming || incoming.length === 0) return;

    const sheet   = getOrCreateSheet(SHEET_NAME_EXPENSES, EXPENSE_HEADERS);
    const rows    = sheet.getDataRange().getValues();
    const headers = rows[0];
    const idCol   = headers.indexOf('id');
    const now     = new Date().toISOString();

    const idToRow = {};
    for (let r = 1; r < rows.length; r++) {
        idToRow[rows[r][idCol]] = r;
    }

    incoming.forEach(exp => {
        const rowValues = EXPENSE_HEADERS.map(h => {
            if (h === 'updatedAt') return now;
            if (h === 'amount')    return Number(exp[h]) || 0;
            return exp[h] !== undefined ? String(exp[h]) : '';
        });

        if (idToRow[exp.id] !== undefined) {
            const sheetRow = idToRow[exp.id] + 1;
            sheet.getRange(sheetRow, 1, 1, EXPENSE_HEADERS.length).setValues([rowValues]);
        } else {
            sheet.appendRow(rowValues);
        }
    });

    SpreadsheetApp.flush();
}

// ─── AUTH DATA ────────────────────────────────────────────────────────────────

/**
 * Reads the full authData object from the meta sheet.
 * Returns null if it has never been saved.
 */
function readAuthData() {
    const sheet = getOrCreateSheet(SHEET_NAME_META, ['key', 'value']);
    const rows  = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === 'authData') {
            try { return JSON.parse(rows[i][1]); } catch { return null; }
        }
    }
    return null;
}

/**
 * Saves (or updates) the authData object as a single JSON string in meta.
 */
function saveAuthData(authDataObj) {
    const sheet    = getOrCreateSheet(SHEET_NAME_META, ['key', 'value']);
    const rows     = sheet.getDataRange().getValues();
    const keyToRow = {};
    rows.slice(1).forEach((r, i) => { keyToRow[r[0]] = i + 2; });

    const json = JSON.stringify(authDataObj);
    if (keyToRow['authData']) {
        sheet.getRange(keyToRow['authData'], 2).setValue(json);
    } else {
        sheet.appendRow(['authData', json]);
    }
    SpreadsheetApp.flush();
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────

function getOrCreateSheet(name, headers) {
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
        sheet = ss.insertSheet(name);
        sheet.appendRow(headers);
        sheet.getRange(1, 1, 1, headers.length)
            .setFontWeight('bold')
            .setBackground('#3525cd')
            .setFontColor('#ffffff');
        sheet.setFrozenRows(1);
    }
    return sheet;
}

function jsonResponse(data) {
    return ContentService
        .createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
}

// ─── MANUAL TEST ─────────────────────────────────────────────────────────────

function testRoundTrip() {
    const sample = [{
        id: 'test-' + Date.now(),
        type: 'paid',
        date: '2025-05-15',
        concept: 'Test Sync',
        amount: 5000,
        paidBy: '1'
    }];
    const sampleAuth = { p1Name: 'Ana', p1Pin: '1234', p1Rut: '12.345.678-9', p2Name: 'Luis', p2Pin: '5678', p2Rut: '98.765.432-1' };

    writeExpenses(sample);
    saveAuthData(sampleAuth);

    Logger.log('Expenses rows: ' + readExpenses().length);
    Logger.log('AuthData: '      + JSON.stringify(readAuthData()));
}
