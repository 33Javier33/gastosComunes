/**
 * SpendSync – Google Apps Script Backend
 *
 * DEPLOY INSTRUCTIONS:
 *  1. Go to https://script.google.com  and create a new project.
 *  2. Paste this entire file into the editor (replacing the default code).
 *  3. Click "Deploy" → "New deployment" → Type: "Web app".
 *  4. Set "Execute as" = Me, "Who has access" = Anyone (or Anyone with link).
 *  5. Click Deploy → copy the Web App URL.
 *  6. Open SpendSync → Settings drawer → paste the URL and save.
 *
 * SHEET STRUCTURE (auto-created on first run):
 *  Sheet "expenses" columns: id | type | date | concept | amount | paidBy | updatedAt
 *  Sheet "meta"     columns: key | value
 */

const SHEET_NAME_EXPENSES = 'expenses';
const SHEET_NAME_META      = 'meta';
const EXPENSE_HEADERS      = ['id', 'type', 'date', 'concept', 'amount', 'paidBy', 'updatedAt'];

// ─── ENTRY POINTS ─────────────────────────────────────────────────────────────

function doGet(e) {
    try {
        const action = (e && e.parameter && e.parameter.action) || 'pull';
        if (action === 'pull') return jsonResponse({ ok: true, expenses: readExpenses() });
        return jsonResponse({ ok: false, error: 'Unknown action' });
    } catch (err) {
        return jsonResponse({ ok: false, error: err.message });
    }
}

function doPost(e) {
    try {
        const body    = JSON.parse(e.postData.contents);
        const action  = body.action || 'push';

        if (action === 'push') {
            writeExpenses(body.expenses || []);
            if (body.meta) saveMeta(body.meta);
            return jsonResponse({ ok: true, written: (body.expenses || []).length });
        }
        return jsonResponse({ ok: false, error: 'Unknown action' });
    } catch (err) {
        return jsonResponse({ ok: false, error: err.message });
    }
}

// ─── READ ─────────────────────────────────────────────────────────────────────

function readExpenses() {
    const sheet = getOrCreateSheet(SHEET_NAME_EXPENSES, EXPENSE_HEADERS);
    const rows  = sheet.getDataRange().getValues();
    if (rows.length <= 1) return []; // only headers

    const headers = rows[0];
    return rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i]; });
        // Normalise amount to number
        obj.amount = Number(obj.amount) || 0;
        return obj;
    });
}

// ─── WRITE (upsert by id) ─────────────────────────────────────────────────────

function writeExpenses(incoming) {
    if (!incoming || incoming.length === 0) return;

    const sheet   = getOrCreateSheet(SHEET_NAME_EXPENSES, EXPENSE_HEADERS);
    const rows    = sheet.getDataRange().getValues();
    const headers = rows[0];
    const idCol   = headers.indexOf('id');           // 0-based column index
    const now     = new Date().toISOString();

    // Build a map of existing row indices keyed by expense id
    const idToRow = {};
    for (let r = 1; r < rows.length; r++) {
        idToRow[rows[r][idCol]] = r; // 0-based, offset +1 for sheet (1-based later)
    }

    incoming.forEach(exp => {
        const rowValues = EXPENSE_HEADERS.map(h => {
            if (h === 'updatedAt') return now;
            if (h === 'amount')    return Number(exp[h]) || 0;
            return exp[h] !== undefined ? String(exp[h]) : '';
        });

        if (idToRow[exp.id] !== undefined) {
            // Update existing row (sheet rows are 1-based; row 0 = header)
            const sheetRow = idToRow[exp.id] + 1; // +1 because sheet is 1-indexed
            sheet.getRange(sheetRow, 1, 1, EXPENSE_HEADERS.length).setValues([rowValues]);
        } else {
            // Append new row
            sheet.appendRow(rowValues);
        }
    });

    // Flush changes
    SpreadsheetApp.flush();
}

// ─── META ─────────────────────────────────────────────────────────────────────

function saveMeta(meta) {
    const sheet = getOrCreateSheet(SHEET_NAME_META, ['key', 'value']);
    const rows  = sheet.getDataRange().getValues();
    const keyToRow = {};
    rows.slice(1).forEach((r, i) => { keyToRow[r[0]] = i + 2; }); // 1-based + header

    Object.entries(meta).forEach(([k, v]) => {
        if (keyToRow[k]) {
            sheet.getRange(keyToRow[k], 2).setValue(v);
        } else {
            sheet.appendRow([k, v]);
        }
    });
    SpreadsheetApp.flush();
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────

function getOrCreateSheet(name, headers) {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    let sheet   = ss.getSheetByName(name);
    if (!sheet) {
        sheet = ss.insertSheet(name);
        sheet.appendRow(headers);
        // Style header row
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

/**
 * Run this function manually in the Apps Script editor to verify the sheet
 * is created correctly and the read/write cycle works.
 */
function testRoundTrip() {
    const sample = [{
        id: 'test-' + Date.now(),
        type: 'paid',
        date: '2025-05-15',
        concept: 'Test Sync',
        amount: 5000,
        paidBy: '1'
    }];
    writeExpenses(sample);
    const result = readExpenses();
    Logger.log('Round-trip test — rows in sheet: ' + result.length);
    Logger.log(JSON.stringify(result.slice(-1)));
}
