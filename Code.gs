/**
 * SpendSync – Google Apps Script Backend
 *
 * HOJAS (creadas automáticamente al primer uso):
 *   "Gastos"        → id | fecha | concepto | monto | pagador | tipo
 *   "Configuracion" → clave | valor
 *
 * CÓMO DESPLEGAR:
 *   1. https://script.google.com → nuevo proyecto → pegar este archivo
 *   2. Deploy → New deployment → Web app
 *   3. "Execute as": Me  |  "Who has access": Anyone
 *   4. Copiar la URL y reemplazar GAS_URL en index.js
 *   5. En cada cambio de código: Deploy → Manage deployments → editar → nueva versión
 *
 * EDITAR DESDE SHEETS:
 *   Se puede editar, agregar o borrar filas directamente en la hoja "Gastos".
 *   Los cambios se reflejan en la app al abrir o al hacer Sincronizar.
 *   Columna "pagador": usar  1  (usuario 1),  2  (usuario 2)  o  compartido
 *   Columna "tipo":    usar  gasto  o  pendiente
 */

const HOJA_GASTOS  = 'Gastos';
const HOJA_CONFIG  = 'Configuracion';
const COL_GASTOS   = ['id', 'fecha', 'concepto', 'monto', 'pagador', 'tipo'];
const COL_CONFIG   = ['clave', 'valor'];
const COLOR_HEADER = '#3525cd';

// ─── ENDPOINTS ────────────────────────────────────────────────────────────────

function doGet() {
    try {
        return ok({ gastos: leerGastos(), config: leerConfig() });
    } catch (err) {
        return fallo(err.message);
    }
}

function doPost(e) {
    try {
        const b = JSON.parse(e.postData.contents);

        if (b.action === 'push') {
            if (b.config) guardarConfig(b.config);
            escribirGastos(b.gastos || []);
            return ok({ guardados: (b.gastos || []).length });
        }

        if (b.action === 'reset') {
            vaciarDatos(HOJA_GASTOS);
            vaciarDatos(HOJA_CONFIG);
            return ok({ reset: true });
        }

        return fallo('Acción desconocida: ' + b.action);
    } catch (err) {
        return fallo(err.message);
    }
}

// ─── LEER ─────────────────────────────────────────────────────────────────────

function leerGastos() {
    const hoja = obtenerHoja(HOJA_GASTOS, COL_GASTOS);
    if (hoja.getLastRow() <= 1) return [];

    const filas = hoja.getDataRange().getValues();
    const cabs  = filas[0].map(String);

    return filas.slice(1)
        .filter(f => f[0] !== '' && f[0] !== null && f[0] !== undefined)
        .map(f => {
            const obj = {};
            cabs.forEach((c, i) => {
                let v = f[i];
                // Sheets auto-convierte "YYYY-MM-DD" a Date; lo revertimos
                if (v instanceof Date) {
                    v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
                }
                obj[c] = v;
            });
            obj.id    = String(obj.id ?? '');
            obj.monto = Number(obj.monto) || 0;
            // Validar pagador y tipo para filas editadas manualmente
            if (!['1', '2', 'compartido'].includes(String(obj.pagador))) obj.pagador = '1';
            if (!['gasto', 'pendiente', 'propuesto_1', 'propuesto_2'].includes(String(obj.tipo))) obj.tipo = 'gasto';
            return obj;
        })
        .filter(g => g.id); // ignorar filas sin ID
}

function leerConfig() {
    const hoja = obtenerHoja(HOJA_CONFIG, COL_CONFIG);
    if (hoja.getLastRow() <= 1) return null;

    const filas = hoja.getDataRange().getValues();
    const obj   = {};
    filas.slice(1).forEach(f => {
        if (f[0]) obj[String(f[0])] = String(f[1] ?? '');
    });
    return Object.keys(obj).length >= 4 ? obj : null; // mínimo nombre1/2 + pin1/2
}

// ─── ESCRIBIR ─────────────────────────────────────────────────────────────────

function escribirGastos(gastos) {
    const hoja = obtenerHoja(HOJA_GASTOS, COL_GASTOS);

    // Limpiar datos anteriores (mantener encabezado)
    if (hoja.getLastRow() > 1) {
        hoja.getRange(2, 1, hoja.getLastRow() - 1, COL_GASTOS.length).clearContent();
    }
    if (gastos.length === 0) { SpreadsheetApp.flush(); return; }

    const filas = gastos.map(g => [
        String(g.id       || ''),
        String(g.fecha    || '').substring(0, 10),
        String(g.concepto || ''),
        Number(g.monto)   || 0,
        String(g.pagador  || '1'),
        String(g.tipo     || 'gasto')
    ]);

    hoja.getRange(2, 1, filas.length, COL_GASTOS.length).setValues(filas);
    // Forzar texto en id (col 1) y fecha (col 2) para evitar conversiones de Sheets
    hoja.getRange(2, 1, filas.length, 1).setNumberFormat('@STRING@');
    hoja.getRange(2, 2, filas.length, 1).setNumberFormat('@STRING@');
    SpreadsheetApp.flush();
}

function guardarConfig(cfg) {
    const hoja = obtenerHoja(HOJA_CONFIG, COL_CONFIG);
    if (hoja.getLastRow() > 1) {
        hoja.getRange(2, 1, hoja.getLastRow() - 1, COL_CONFIG.length).clearContent();
    }
    const filas = Object.entries(cfg).map(([k, v]) => [k, String(v)]);
    if (filas.length > 0) {
        hoja.getRange(2, 1, filas.length, COL_CONFIG.length).setValues(filas);
    }
    SpreadsheetApp.flush();
}

function vaciarDatos(nombre) {
    const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
    if (hoja && hoja.getLastRow() > 1) {
        hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).clearContent();
        SpreadsheetApp.flush();
    }
}

// ─── UTILIDADES ───────────────────────────────────────────────────────────────

function obtenerHoja(nombre, cabeceras) {
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    let hoja   = ss.getSheetByName(nombre);
    if (!hoja) {
        hoja = ss.insertSheet(nombre);
        hoja.appendRow(cabeceras);
        hoja.getRange(1, 1, 1, cabeceras.length)
            .setBackground(COLOR_HEADER)
            .setFontColor('#ffffff')
            .setFontWeight('bold');
        hoja.setFrozenRows(1);
        hoja.autoResizeColumns(1, cabeceras.length);
    }
    return hoja;
}

function ok(datos) {
    return ContentService
        .createTextOutput(JSON.stringify({ ok: true, ...datos }))
        .setMimeType(ContentService.MimeType.JSON);
}

function fallo(msg) {
    return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: msg }))
        .setMimeType(ContentService.MimeType.JSON);
}

// ─── TEST (ejecutar manualmente desde el editor) ──────────────────────────────

function testCompleto() {
    const cfg = {
        nombre1: 'Carlos', pin1: '1234', rut1: '12.345.678-9',
        nombre2: 'Laura',  pin2: '5678', rut2: '98.765.432-1'
    };
    const gastos = [
        { id: '001', fecha: '2026-05-01', concepto: 'Supermercado', monto: 45000, pagador: '1',         tipo: 'gasto'     },
        { id: '002', fecha: '2026-05-10', concepto: 'Luz',          monto: 12000, pagador: '2',         tipo: 'pendiente' },
        { id: '003', fecha: '2026-05-12', concepto: 'Netflix',      monto: 8900,  pagador: 'compartido',tipo: 'gasto'     }
    ];
    guardarConfig(cfg);
    escribirGastos(gastos);
    Logger.log('Config: '  + JSON.stringify(leerConfig()));
    Logger.log('Gastos: '  + JSON.stringify(leerGastos()));
}
