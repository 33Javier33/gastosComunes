/**
 * SpendSync – Google Apps Script Backend
 *
 * SHEET STRUCTURE (auto-created on first run):
 *   Tab "[p1Name]"   → gastos donde paidBy = '1'
 *   Tab "[p2Name]"   → gastos donde paidBy = '2'
 *   Tab "Compartido" → gastos donde paidBy = '3' (50/50)
 *   Tab "meta"       → configuración (authData como JSON)
 *
 * Cada tab tiene encabezados automáticos con fondo azul.
 * Las filas eliminadas (deleted=TRUE) se guardan en el sheet pero el
 * cliente las filtra — así las eliminaciones se propagan a otros dispositivos.
 */

const SHEET_META    = 'meta';
const SHEET_SHARED  = 'Compartido';
const EXP_HEADERS   = ['id', 'type', 'date', 'concept', 'amount', 'paidBy', 'updatedAt', 'deleted'];
const HEADER_COLOR  = '#3525cd';

// ─── ENTRY POINTS ─────────────────────────────────────────────────────────────

function doGet(e) {
    try {
        const action = (e && e.parameter && e.parameter.action) || 'pull';
        if (action === 'pull') {
            const auth     = readAuthData();
            const expenses = readAllExpenses(auth);
            return jsonOk({ expenses, authData: auth });
        }
        return jsonErr('Unknown action');
    } catch (err) {
        return jsonErr(err.message);
    }
}

function doPost(e) {
    try {
        const body   = JSON.parse(e.postData.contents);
        const action = body.action || 'push';

        if (action === 'push') {
            // Save authData first so we have the correct sheet names
            if (body.authData) saveAuthData(body.authData);
            const auth = body.authData || readAuthData();
            writeAllExpenses(body.expenses || [], auth);
            return jsonOk({ written: (body.expenses || []).length });
        }
        return jsonErr('Unknown action');
    } catch (err) {
        return jsonErr(err.message);
    }
}

// ─── READ ALL EXPENSES ────────────────────────────────────────────────────────

function readAllExpenses(auth) {
    const names = userSheetNames(auth);
    const all   = [];

    names.forEach(name => {
        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
        if (!sheet) return;
        const rows = sheet.getDataRange().getValues();
        if (rows.length <= 1) return;  // only headers

        const headers = rows[0].map(String);
        rows.slice(1).forEach(row => {
            // Skip completely empty rows (can happen after clearContent)
            if (!row[0]) return;
            const obj = {};
            headers.forEach((h, i) => { obj[h] = row[i]; });
            obj.amount  = Number(obj.amount) || 0;
            obj.deleted = obj.deleted === true || String(obj.deleted).toUpperCase() === 'TRUE';
            all.push(obj);
        });
    });

    return all;
}

// ─── WRITE ALL EXPENSES (grouped by payer) ────────────────────────────────────

function writeAllExpenses(incoming, auth) {
    const p1Name = (auth && auth.p1Name) || 'Usuario 1';
    const p2Name = (auth && auth.p2Name) || 'Usuario 2';

    // Group by paidBy field
    const groups = { '1': [], '2': [], '3': [] };
    incoming.forEach(exp => {
        const key = groups[exp.paidBy] ? exp.paidBy : '1';
        groups[key].push(exp);
    });

    writeUserSheet(groups['1'], p1Name);
    writeUserSheet(groups['2'], p2Name);
    writeUserSheet(groups['3'], SHEET_SHARED);
}

/**
 * Overwrites a single user's tab with the provided expenses.
 * Clear-and-rewrite ensures deletions propagate correctly.
 */
function writeUserSheet(exps, sheetName) {
    const sheet   = getOrCreateSheet(sheetName, EXP_HEADERS);
    const lastRow = sheet.getLastRow();

    // Clear all data rows, keep header (row 1)
    if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, EXP_HEADERS.length).clearContent();
    }

    if (exps.length === 0) {
        SpreadsheetApp.flush();
        return;
    }

    const now  = new Date().toISOString();
    const rows = exps.map(exp =>
        EXP_HEADERS.map(h => {
            if (h === 'updatedAt') return exp.updatedAt || now;
            if (h === 'amount')    return Number(exp[h]) || 0;
            if (h === 'deleted')   return exp.deleted === true ? 'TRUE' : 'FALSE';
            return exp[h] !== undefined ? String(exp[h]) : '';
        })
    );

    sheet.getRange(2, 1, rows.length, EXP_HEADERS.length).setValues(rows);
    SpreadsheetApp.flush();
}

// ─── AUTH DATA ────────────────────────────────────────────────────────────────

function readAuthData() {
    const sheet = getOrCreateSheet(SHEET_META, ['key', 'value']);
    const rows  = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === 'authData') {
            try { return JSON.parse(rows[i][1]); } catch { return null; }
        }
    }
    return null;
}

function saveAuthData(obj) {
    const sheet    = getOrCreateSheet(SHEET_META, ['key', 'value']);
    const rows     = sheet.getDataRange().getValues();
    const keyToRow = {};
    rows.slice(1).forEach((r, i) => { keyToRow[String(r[0])] = i + 2; }); // 1-based

    const json = JSON.stringify(obj);
    if (keyToRow['authData']) {
        sheet.getRange(keyToRow['authData'], 2).setValue(json);
    } else {
        sheet.appendRow(['authData', json]);
    }
    SpreadsheetApp.flush();
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────

/** Returns the three sheet names to read from in order. */
function userSheetNames(auth) {
    return [
        (auth && auth.p1Name) || 'Usuario 1',
        (auth && auth.p2Name) || 'Usuario 2',
        SHEET_SHARED
    ];
}

function getOrCreateSheet(name, headers) {
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
        sheet = ss.insertSheet(name);
        sheet.appendRow(headers);
        sheet.getRange(1, 1, 1, headers.length)
            .setFontWeight('bold')
            .setBackground(HEADER_COLOR)
            .setFontColor('#ffffff');
        sheet.setFrozenRows(1);
        // Auto-resize columns for readability
        sheet.autoResizeColumns(1, headers.length);
    }
    return sheet;
}

function jsonOk(extra) {
    return ContentService
        .createTextOutput(JSON.stringify({ ok: true, ...extra }))
        .setMimeType(ContentService.MimeType.JSON);
}

function jsonErr(msg) {
    return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: msg }))
        .setMimeType(ContentService.MimeType.JSON);
}

// ─── MANUAL TEST ─────────────────────────────────────────────────────────────

function testRoundTrip() {
    const auth = { p1Name: 'Ana', p1Pin: '1234', p1Rut: '12.345.678-9',
                   p2Name: 'Luis', p2Pin: '5678', p2Rut: '98.765.432-1' };
    const exps = [
        { id: 'a1', type: 'paid',    date: '2025-05-01', concept: 'Supermercado', amount: 45000, paidBy: '1', deleted: false },
        { id: 'b1', type: 'pending', date: '2025-05-10', concept: 'Luz',          amount: 12000, paidBy: '2', deleted: false },
        { id: 'c1', type: 'paid',    date: '2025-05-12', concept: 'Netflix',      amount: 8900,  paidBy: '3', deleted: false }
    ];

    saveAuthData(auth);
    writeAllExpenses(exps, auth);

    const result = readAllExpenses(auth);
    Logger.log('Total rows: ' + result.length);
    Logger.log('AuthData: ' + JSON.stringify(readAuthData()));
    result.forEach(r => Logger.log(JSON.stringify(r)));
}
