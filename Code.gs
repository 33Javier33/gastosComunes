/**
 * SpendSync – Google Apps Script Backend
 *
 * SHEET STRUCTURE (auto-created):
 *   "Usuarios"       → nombre, RUT, PIN de cada usuario (legible para humanos)
 *   "meta"           → authData como JSON (lectura rápida)
 *   "[p1Name]"       → gastos de usuario 1
 *   "[p2Name]"       → gastos de usuario 2
 *   "Compartido"     → gastos 50/50
 *
 * IMPORTANTE: Republicar el Web App en cada cambio de código:
 *   Deploy → Manage deployments → editar → nueva versión → Deploy
 */

const SHEET_META     = 'meta';
const SHEET_USUARIOS = 'Usuarios';
const SHEET_SHARED   = 'Compartido';
const EXP_HEADERS    = ['id', 'type', 'date', 'concept', 'amount', 'paidBy', 'updatedAt', 'deleted'];
const USR_HEADERS    = ['Número', 'Nombre', 'RUT', 'PIN'];
const HEADER_COLOR   = '#3525cd';

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

// ─── AUTH DATA ────────────────────────────────────────────────────────────────

/**
 * Saves auth to TWO places:
 * 1. meta sheet  → JSON blob for fast reads
 * 2. Usuarios sheet → human-readable table so it's visible per-user
 */
function saveAuthData(obj) {
    // 1. meta sheet (JSON)
    const metaSheet = getOrCreateSheet(SHEET_META, ['key', 'value']);
    const metaRows  = metaSheet.getDataRange().getValues();
    const keyToRow  = {};
    metaRows.slice(1).forEach((r, i) => { keyToRow[String(r[0])] = i + 2; });
    const json = JSON.stringify(obj);
    if (keyToRow['authData']) {
        metaSheet.getRange(keyToRow['authData'], 2).setValue(json);
    } else {
        metaSheet.appendRow(['authData', json]);
    }

    // 2. Usuarios sheet (human-readable — one row per user)
    const usuSheet = getOrCreateSheet(SHEET_USUARIOS, USR_HEADERS);
    const lastRow  = usuSheet.getLastRow();
    if (lastRow > 1) {
        usuSheet.getRange(2, 1, lastRow - 1, USR_HEADERS.length).clearContent();
    }
    // Número | Nombre | RUT | PIN
    usuSheet.appendRow(['1', obj.p1Name, obj.p1Rut, obj.p1Pin]);
    usuSheet.appendRow(['2', obj.p2Name, obj.p2Rut, obj.p2Pin]);

    SpreadsheetApp.flush();
}

/**
 * Reads auth. Tries meta sheet first (fast), falls back to Usuarios sheet.
 */
function readAuthData() {
    // --- Fast path: meta JSON ---
    const ss        = SpreadsheetApp.getActiveSpreadsheet();
    const metaSheet = ss.getSheetByName(SHEET_META);
    if (metaSheet) {
        const rows = metaSheet.getDataRange().getValues();
        for (let i = 1; i < rows.length; i++) {
            if (String(rows[i][0]) === 'authData' && rows[i][1]) {
                try { return JSON.parse(rows[i][1]); } catch (_) { break; }
            }
        }
    }

    // --- Fallback: rebuild from Usuarios sheet ---
    const usuSheet = ss.getSheetByName(SHEET_USUARIOS);
    if (usuSheet) {
        const rows = usuSheet.getDataRange().getValues();
        // rows[0] = headers; find the two user rows
        const users = rows.slice(1).filter(r => r[0]); // skip empty rows
        if (users.length >= 2) {
            // columns: Número | Nombre | RUT | PIN
            const u1 = users.find(r => String(r[0]) === '1') || users[0];
            const u2 = users.find(r => String(r[0]) === '2') || users[1];
            return {
                p1Name: String(u1[1]), p1Rut: String(u1[2]), p1Pin: String(u1[3]),
                p2Name: String(u2[1]), p2Rut: String(u2[2]), p2Pin: String(u2[3])
            };
        }
    }

    return null;
}

// ─── READ EXPENSES ────────────────────────────────────────────────────────────

function readAllExpenses(auth) {
    const names = expenseSheetNames(auth);
    const all   = [];
    const ss    = SpreadsheetApp.getActiveSpreadsheet();

    names.forEach(name => {
        const sheet = ss.getSheetByName(name);
        if (!sheet) return;
        const rows = sheet.getDataRange().getValues();
        if (rows.length <= 1) return;

        const headers = rows[0].map(String);
        rows.slice(1).forEach(row => {
            if (!row[0] && row[0] !== 0) return; // skip empty rows
            all.push(parseExpenseRow(headers, row));
        });
    });

    return all;
}

/**
 * Converts a raw sheet row into a clean expense object.
 * Google Sheets auto-converts date strings → Date objects and
 * numeric strings → numbers. We fix that here.
 */
function parseExpenseRow(headers, row) {
    const obj = {};
    headers.forEach((h, i) => {
        let val = row[i];
        // Sheets turns "YYYY-MM-DD" strings into Date objects
        if (val instanceof Date) {
            val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        }
        obj[h] = val;
    });

    // Normalise types that Sheets may have changed
    obj.id      = String(obj.id ?? '');           // numeric id → string
    obj.amount  = Number(obj.amount) || 0;
    obj.paidBy  = String(obj.paidBy ?? '1');
    obj.deleted = obj.deleted === true || String(obj.deleted).toUpperCase() === 'TRUE';

    return obj;
}

// ─── WRITE EXPENSES ───────────────────────────────────────────────────────────

function writeAllExpenses(incoming, auth) {
    const p1Name = (auth && auth.p1Name) || 'Usuario 1';
    const p2Name = (auth && auth.p2Name) || 'Usuario 2';

    const groups = { '1': [], '2': [], '3': [] };
    incoming.forEach(exp => {
        const key = String(exp.paidBy);
        if (groups[key]) groups[key].push(exp);
        else groups['1'].push(exp); // fallback
    });

    writeUserSheet(groups['1'], p1Name);
    writeUserSheet(groups['2'], p2Name);
    writeUserSheet(groups['3'], SHEET_SHARED);
}

function writeUserSheet(exps, sheetName) {
    const sheet   = getOrCreateSheet(sheetName, EXP_HEADERS);
    const lastRow = sheet.getLastRow();

    if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, EXP_HEADERS.length).clearContent();
    }
    if (exps.length === 0) { SpreadsheetApp.flush(); return; }

    const now  = new Date().toISOString();
    const rows = exps.map(exp =>
        EXP_HEADERS.map(h => {
            if (h === 'id')        return String(exp.id ?? '');   // keep as string
            if (h === 'updatedAt') return exp.updatedAt || now;
            if (h === 'amount')    return Number(exp[h]) || 0;
            if (h === 'deleted')   return exp.deleted === true ? 'TRUE' : 'FALSE';
            if (h === 'date')      return String(exp.date || '').substring(0, 10); // YYYY-MM-DD only
            return exp[h] !== undefined ? String(exp[h]) : '';
        })
    );

    sheet.getRange(2, 1, rows.length, EXP_HEADERS.length).setValues(rows);

    // Force id and date columns to plain text so Sheets doesn't reinterpret them
    sheet.getRange(2, 1, rows.length, 1).setNumberFormat('@STRING@');           // col A = id
    sheet.getRange(2, 3, rows.length, 1).setNumberFormat('@STRING@');           // col C = date

    SpreadsheetApp.flush();
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────

function expenseSheetNames(auth) {
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

// ─── TEST ─────────────────────────────────────────────────────────────────────

function testRoundTrip() {
    const auth = { p1Name: 'Carlos', p1Pin: '1234', p1Rut: '12.345.678-9',
                   p2Name: 'Laura',  p2Pin: '5678', p2Rut: '98.765.432-1' };
    const exps = [
        { id: '1747000001', type: 'paid',    date: '2026-05-01', concept: 'Supermercado', amount: 45000, paidBy: '1', deleted: false },
        { id: '1747000002', type: 'pending', date: '2026-05-10', concept: 'Luz',          amount: 12000, paidBy: '2', deleted: false },
        { id: '1747000003', type: 'paid',    date: '2026-05-12', concept: 'Netflix',      amount: 8900,  paidBy: '3', deleted: false }
    ];

    saveAuthData(auth);
    writeAllExpenses(exps, auth);

    const result = readAllExpenses(auth);
    Logger.log('AuthData: '      + JSON.stringify(readAuthData()));
    Logger.log('Total expenses: ' + result.length);
    result.forEach(r => Logger.log(r.id + ' | ' + r.date + ' | ' + r.concept));
}
