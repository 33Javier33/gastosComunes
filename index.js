// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────

const GAS_URL = 'https://script.google.com/macros/s/AKfycbwEVnRw5npVWcO7EI8u5lS2KbHeq5dYlh_41wHl1ZugSNq7gdpSaOiIRO1ek8Rlb-Tr/exec';

// ─── ESTADO ───────────────────────────────────────────────────────────────────

let config  = JSON.parse(localStorage.getItem('ss_config') || 'null');
let gastos  = JSON.parse(localStorage.getItem('ss_gastos')  || '[]');
let usuario = null;   // '1' o '2'
let pagSel  = '1';    // payer seleccionado en formulario
let editId  = null;   // id del gasto en edición
let editPag = '1';    // payer en modal de edición
let syncTimer  = null;
let sincroni   = false;

// ─── AUTO-LOGOUT ──────────────────────────────────────────────────────────────

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && usuario) {
        sessionStorage.removeItem('ss_usuario');
        usuario = null;
    }
    if (document.visibilityState === 'visible' && config && !sessionStorage.getItem('ss_usuario')) {
        mostrarLogin();
    }
});

// ─── BOOT ─────────────────────────────────────────────────────────────────────

async function initApp() {
    // Tras un reset completo, ir directo a configuración sin pull
    if (localStorage.getItem('ss_reset')) {
        localStorage.removeItem('ss_reset');
        mostrarVista('setup-view');
        return;
    }

    const sesion = sessionStorage.getItem('ss_usuario');

    if (config) {
        // Hay config local → mostrar login o app
        if (sesion) {
            usuario = sesion;
            lanzarApp();
        } else {
            mostrarLogin();
        }
        // Pull silencioso en segundo plano para reflejar cambios del Sheet
        pullSilencioso();
        return;
    }

    // Sin config local → intentar cargar desde el Sheet
    bootLoader(true);
    try {
        const r = await pullDeSheet();
        bootLoader(false);
        if (r.config) {
            config = r.config;
            gastos = normalizarGastos(r.gastos || []);
            guardarLocal();
            if (sesion) { usuario = sesion; lanzarApp(); } else mostrarLogin();
        } else {
            // El servidor respondió pero no hay configuración → es una cuenta nueva
            mostrarVista('setup-view');
        }
    } catch {
        // Error de red o del servidor → mostrar pantalla de reintento, NO setup
        bootLoader(true, true);
    }
}

function bootLoader(mostrar, error = false) {
    const el = document.getElementById('boot-loader');
    if (!mostrar) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const icon  = document.getElementById('boot-icon');
    const msg   = document.getElementById('boot-msg');
    const retry = document.getElementById('boot-retry');
    const setup = document.getElementById('boot-setup');
    if (error) {
        icon.textContent = 'cloud_off';
        icon.classList.remove('spinning');
        msg.textContent = 'No se pudo conectar. Verifica tu conexión.';
        retry.classList.remove('hidden');
        setup.classList.remove('hidden');
    } else {
        icon.textContent = 'cloud_sync';
        icon.classList.add('spinning');
        msg.textContent = 'Cargando configuración…';
        retry.classList.add('hidden');
        setup.classList.add('hidden');
    }
}

window.reintentar = function () {
    bootLoader(false);
    initApp();
};

// ─── VISTAS ───────────────────────────────────────────────────────────────────

function mostrarVista(id) {
    document.querySelectorAll('.vista').forEach(v => v.classList.add('hidden'));
    const t = document.getElementById(id);
    t.classList.remove('hidden');
    t.classList.add(id === 'main-view' ? 'block' : 'flex');
    document.querySelectorAll('.alerta').forEach(a => { a.classList.add('hidden'); a.textContent = ''; });
}

function mostrarAlerta(id, msg, esInfo = false) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.classList.remove('hidden', 'text-error', 'text-secondary');
    el.classList.add(esInfo ? 'text-secondary' : 'text-error');
}

function mostrarLogin() {
    document.getElementById('login-u1-nombre').textContent = config.nombre1;
    document.getElementById('login-u2-nombre').textContent = config.nombre2;
    seleccionarUsuarioLogin('1');
    mostrarVista('login-view');
}

// ─── SETUP ────────────────────────────────────────────────────────────────────

document.getElementById('setup-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const n1  = v('setup-n1'), p1 = v('setup-p1'), r1 = v('setup-r1');
    const n2  = v('setup-n2'), p2 = v('setup-p2'), r2 = v('setup-r2');

    if (p1.length !== 4 || p2.length !== 4) {
        mostrarAlerta('setup-alert', 'Los PINs deben tener exactamente 4 dígitos.');
        return;
    }

    config = { nombre1: n1, pin1: p1, rut1: r1, nombre2: n2, pin2: p2, rut2: r2 };
    guardarLocal();

    const btn = this.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Guardando…';

    try {
        await pushASheet();
        mostrarAlerta('setup-alert', '¡Configuración guardada! Ambos dispositivos quedarán sincronizados.', true);
        setTimeout(() => { sessionStorage.setItem('ss_usuario', '1'); usuario = '1'; lanzarApp(); }, 1200);
    } catch (err) {
        mostrarAlerta('setup-alert', 'Guardado local. Sin conexión al Sheet: ' + err.message);
        btn.textContent = 'Continuar sin sync';
        btn.disabled = false;
        btn.onclick = () => { sessionStorage.setItem('ss_usuario', '1'); usuario = '1'; lanzarApp(); };
    }
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────

let loginUser = '1';

function seleccionarUsuarioLogin(u) {
    loginUser = u;
    ['1','2'].forEach(n => {
        const btn = document.getElementById('login-btn-u' + n);
        const activo = n === u;
        btn.classList.toggle('border-primary', activo);
        btn.classList.toggle('border-2', activo);
        btn.classList.toggle('border-outline-variant', !activo);
    });
}

document.getElementById('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const pin = v('login-pin');
    const ok  = loginUser === '1' ? pin === config.pin1 : pin === config.pin2;
    if (ok) {
        sessionStorage.setItem('ss_usuario', loginUser);
        usuario = loginUser;
        document.getElementById('login-pin').value = '';
        lanzarApp();
    } else {
        mostrarAlerta('login-alert', 'PIN incorrecto.');
        document.getElementById('login-pin').value = '';
    }
});

document.getElementById('recovery-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const rut = v('recovery-rut');
    if (rut === config.rut1)      mostrarAlerta('recovery-alert', `PIN de ${config.nombre1}: ${config.pin1}`, true);
    else if (rut === config.rut2) mostrarAlerta('recovery-alert', `PIN de ${config.nombre2}: ${config.pin2}`, true);
    else                           mostrarAlerta('recovery-alert', 'RUT no encontrado.');
});

window.logout = function () {
    sessionStorage.removeItem('ss_usuario');
    usuario = null;
    initApp();
};

// ─── APP PRINCIPAL ────────────────────────────────────────────────────────────

function lanzarApp() {
    mostrarVista('main-view');

    const nombre = usuario === '1' ? config.nombre1 : config.nombre2;
    document.getElementById('header-nombre').textContent = nombre;
    document.getElementById('header-inicial').textContent = nombre.charAt(0).toUpperCase();
    document.getElementById('btn-pag-1').textContent = config.nombre1;
    document.getElementById('btn-pag-2').textContent = config.nombre2;
    document.getElementById('lbl-total-n1').textContent = config.nombre1;
    document.getElementById('lbl-total-n2').textContent = config.nombre2;
    document.getElementById('lbl-pend-n1').textContent  = 'Pendiente ' + config.nombre1;
    document.getElementById('lbl-pend-n2').textContent  = 'Pendiente ' + config.nombre2;

    document.getElementById('fecha').valueAsDate = new Date();
    seleccionarPagador('1');
    renderTodo();
}

// ─── AGREGAR GASTO ────────────────────────────────────────────────────────────

document.getElementById('monto').addEventListener('input', function () {
    const v = this.value.replace(/\D/g, '');
    this.value = v ? new Intl.NumberFormat('es-CL').format(+v) : '';
});

function seleccionarPagador(p) {
    pagSel = p;
    ['1','2','compartido'].forEach(x => {
        const btn = document.getElementById('btn-pag-' + x);
        const sel = x === p;
        btn.classList.toggle('border-primary', sel);
        btn.classList.toggle('text-primary', sel);
        btn.classList.toggle('bg-primary/10', sel);
        btn.classList.toggle('border-outline-variant', !sel);
        btn.classList.toggle('text-on-surface-variant', !sel);
    });
}

document.getElementById('gasto-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const monto = +v('monto').replace(/\D/g, '');
    if (!monto) return;

    gastos.push({
        id:       Date.now().toString(),
        fecha:    v('fecha'),
        concepto: v('concepto').trim(),
        monto,
        pagador:  pagSel,
        tipo:     document.getElementById('es-pendiente').checked ? 'pendiente' : 'gasto'
    });

    guardarLocal();
    schedulePush();
    this.reset();
    document.getElementById('fecha').valueAsDate = new Date();
    document.getElementById('es-pendiente').checked = false;
    document.getElementById('concepto').focus();
    seleccionarPagador('1');
    renderTodo();
});

// ─── ACCIONES SOBRE GASTOS ────────────────────────────────────────────────────

// ─── PAGO DE PENDIENTE ────────────────────────────────────────────────────────

let pagoId  = null;
let pagoUsr = '1';

window.abrirPago = function (id) {
    const g = gastos.find(x => x.id === id);
    if (!g) return;
    pagoId = id;

    const es50 = g.pagador === 'compartido';
    document.getElementById('pago-titulo').textContent = es50 ? 'Registrar pago (50/50)' : 'Registrar pago';
    document.getElementById('pago-concepto').textContent = g.concepto;

    const quienEl = document.getElementById('pago-quien');
    quienEl.classList.toggle('hidden', !es50);

    if (es50) {
        document.getElementById('pago-btn-u1').textContent = config.nombre1;
        document.getElementById('pago-btn-u2').textContent = config.nombre2;
        seleccionarPagoUsr(usuario || '1');
        document.getElementById('pago-hint').textContent = `Tu parte del 50/50: ${fmt(Math.round(g.monto / 2))} (total: ${fmt(g.monto)})`;
        document.getElementById('pago-monto').value = new Intl.NumberFormat('es-CL').format(Math.round(g.monto / 2));
    } else {
        document.getElementById('pago-hint').textContent = `Total pendiente: ${fmt(g.monto)}`;
        document.getElementById('pago-monto').value = new Intl.NumberFormat('es-CL').format(g.monto);
    }

    document.getElementById('pago-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('pago-monto').select(), 50);
};

window.seleccionarPagoUsr = function (u) {
    pagoUsr = u;
    ['1', '2'].forEach(n => {
        const btn = document.getElementById('pago-btn-u' + n);
        const sel = n === u;
        btn.classList.toggle('border-primary', sel);
        btn.classList.toggle('text-primary', sel);
        btn.classList.toggle('bg-primary/10', sel);
        btn.classList.toggle('border-outline-variant', !sel);
        btn.classList.toggle('text-on-surface-variant', !sel);
    });
    const g = gastos.find(x => x.id === pagoId);
    if (g && g.pagador === 'compartido') {
        document.getElementById('pago-monto').value = new Intl.NumberFormat('es-CL').format(Math.round(g.monto / 2));
    }
};

window.cerrarPago = function () {
    document.getElementById('pago-modal').classList.add('hidden');
    pagoId = null;
};

window.fondoPagoModal = function (e) {
    if (e.target === document.getElementById('pago-modal')) cerrarPago();
};

window.confirmarPago = function () {
    const g = gastos.find(x => x.id === pagoId);
    if (!g) return;
    const montoPagado = +document.getElementById('pago-monto').value.replace(/\D/g, '');
    if (!montoPagado) return;

    const ts = Date.now();
    gastos = gastos.filter(x => x.id !== pagoId);

    if (g.pagador === 'compartido') {
        const mitad = Math.round(g.monto / 2);
        const otroUsr = pagoUsr === '1' ? '2' : '1';

        // Gasto por el monto efectivamente pagado
        gastos.push({ id: String(ts), fecha: g.fecha, concepto: g.concepto, monto: montoPagado, pagador: pagoUsr, tipo: 'gasto' });

        // Si pagó menos de su mitad, queda pendiente para él
        const restanteProp = Math.max(0, mitad - montoPagado);
        if (restanteProp > 0) {
            gastos.push({ id: String(ts + 1), fecha: g.fecha, concepto: g.concepto, monto: restanteProp, pagador: pagoUsr, tipo: 'pendiente' });
        }

        // La mitad del otro usuario (reducida si se pagó de más)
        const cubiertaAjena = Math.max(0, montoPagado - mitad);
        const restanteOtro  = mitad - cubiertaAjena;
        if (restanteOtro > 0) {
            gastos.push({ id: String(ts + 2), fecha: g.fecha, concepto: g.concepto, monto: restanteOtro, pagador: otroUsr, tipo: 'pendiente' });
        }
    } else {
        // Pendiente individual → gasto + pendiente reducido si fue pago parcial
        gastos.push({ id: String(ts), fecha: g.fecha, concepto: g.concepto, monto: montoPagado, pagador: g.pagador, tipo: 'gasto' });
        const restante = g.monto - montoPagado;
        if (restante > 0) {
            gastos.push({ id: String(ts + 1), fecha: g.fecha, concepto: g.concepto, monto: restante, pagador: g.pagador, tipo: 'pendiente' });
        }
    }

    guardarLocal();
    schedulePush();
    renderTodo();
    cerrarPago();
};

document.getElementById('pago-monto').addEventListener('input', function () {
    const val = this.value.replace(/\D/g, '');
    this.value = val ? new Intl.NumberFormat('es-CL').format(+val) : '';
});

window.eliminar = function (id) {
    if (!confirm('¿Eliminar este movimiento?')) return;
    gastos = gastos.filter(x => x.id !== id);
    guardarLocal();
    schedulePush();
    renderTodo();
};

window.abrirEditar = function (id) {
    const g = gastos.find(x => x.id === id);
    if (!g) return;
    editId  = id;
    document.getElementById('edit-concepto').value = g.concepto;
    document.getElementById('edit-monto').value = new Intl.NumberFormat('es-CL').format(g.monto);
    document.getElementById('edit-fecha').value  = g.fecha;
    document.getElementById('edit-pendiente').checked = g.tipo === 'pendiente';
    document.getElementById('edit-btn-pag-1').textContent = config.nombre1;
    document.getElementById('edit-btn-pag-2').textContent = config.nombre2;
    seleccionarEditPagador(g.pagador);
    document.getElementById('edit-modal').classList.remove('hidden');
};

window.cerrarEditar = function () {
    document.getElementById('edit-modal').classList.add('hidden');
    editId = null;
};

window.fondoModal = function (e) {
    if (e.target === document.getElementById('edit-modal')) cerrarEditar();
};

document.getElementById('edit-monto').addEventListener('input', function () {
    const v = this.value.replace(/\D/g, '');
    this.value = v ? new Intl.NumberFormat('es-CL').format(+v) : '';
});

function seleccionarEditPagador(p) {
    editPag = p;
    ['1','2','compartido'].forEach(x => {
        const btn = document.getElementById('edit-btn-pag-' + x);
        const sel = x === p;
        btn.classList.toggle('border-primary', sel);
        btn.classList.toggle('text-primary', sel);
        btn.classList.toggle('bg-primary/10', sel);
        btn.classList.toggle('border-outline-variant', !sel);
        btn.classList.toggle('text-on-surface-variant', !sel);
    });
}

document.getElementById('edit-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const idx = gastos.findIndex(x => x.id === editId);
    if (idx === -1) return;
    gastos[idx] = {
        ...gastos[idx],
        concepto: v('edit-concepto').trim(),
        monto:    +v('edit-monto').replace(/\D/g, ''),
        fecha:    v('edit-fecha'),
        tipo:     document.getElementById('edit-pendiente').checked ? 'pendiente' : 'gasto',
        pagador:  editPag
    };
    guardarLocal();
    schedulePush();
    renderTodo();
    cerrarEditar();
});

// ─── RENDER ───────────────────────────────────────────────────────────────────

function renderTodo() {
    renderResumen();
    renderPendientes();
    renderHistorial();
}

function renderResumen() {
    let t1 = 0, t2 = 0, tc = 0, p1 = 0, p2 = 0;
    gastos.forEach(g => {
        const m = g.monto;
        if (g.tipo === 'pendiente') {
            if (g.pagador === '1') p1 += m;
            else if (g.pagador === '2') p2 += m;
            else { p1 += m / 2; p2 += m / 2; }
            return;
        }
        if (g.pagador === '1') t1 += m;
        else if (g.pagador === '2') t2 += m;
        else { tc += m; t1 += m / 2; t2 += m / 2; }
    });

    document.getElementById('total-general').textContent = fmt(t1 + t2);
    document.getElementById('total-compartido').textContent = 'Incluye ' + fmt(tc) + ' compartidos';
    document.getElementById('total-n1').textContent = fmt(t1);
    document.getElementById('total-n2').textContent = fmt(t2);
    document.getElementById('pend-n1').textContent  = fmt(p1);
    document.getElementById('pend-n2').textContent  = fmt(p2);
}

function renderPendientes() {
    const lista = document.getElementById('lista-pendientes');
    const vacio = document.getElementById('vacio-pendientes');
    const items = gastos.filter(g => g.tipo === 'pendiente').sort(porFecha);
    lista.innerHTML = '';

    if (!items.length) { vacio.classList.remove('hidden'); return; }
    vacio.classList.add('hidden');

    items.forEach(g => {
        const badge = g.pagador === 'compartido'
            ? `<span class="text-[10px] text-primary font-bold bg-primary/10 px-2 py-0.5 rounded">Cada uno: ${fmt(g.monto / 2)}</span>`
            : '';
        lista.innerHTML += `
        <div class="bg-surface-container-lowest p-4 rounded-2xl border-l-4 border-tertiary shadow-sm">
            <div class="flex justify-between items-start">
                <div>
                    <p class="font-bold text-on-surface">${esc(g.concepto)}</p>
                    <p class="text-xs text-on-surface-variant">${fmtFecha(g.fecha)} · ${nomPagador(g.pagador)}</p>
                    ${badge}
                </div>
                <span class="font-headline-md text-headline-md ml-4">${fmt(g.monto)}</span>
            </div>
            <div class="flex gap-2 mt-3">
                <button onclick="abrirPago('${g.id}')" class="flex-1 h-9 bg-secondary text-on-secondary text-xs font-bold rounded-lg flex items-center justify-center gap-1 active:scale-95">
                    <span class="material-symbols-outlined text-sm">${g.pagador === 'compartido' ? 'payments' : 'check_circle'}</span>${g.pagador === 'compartido' ? 'Abonar / Pagar' : 'Marcar pagado'}
                </button>
                <button onclick="abrirEditar('${g.id}')" class="w-9 h-9 border border-primary text-primary rounded-lg flex items-center justify-center active:scale-95">
                    <span class="material-symbols-outlined text-sm">edit</span>
                </button>
                <button onclick="eliminar('${g.id}')" class="w-9 h-9 border border-error text-error rounded-lg flex items-center justify-center active:scale-95">
                    <span class="material-symbols-outlined text-sm">delete</span>
                </button>
            </div>
        </div>`;
    });
}

function renderHistorial() {
    const lista = document.getElementById('lista-gastos');
    const vacio = document.getElementById('vacio-gastos');
    const items = gastos.filter(g => g.tipo === 'gasto').sort(porFecha);
    lista.innerHTML = '';

    if (!items.length) { vacio.classList.remove('hidden'); return; }
    vacio.classList.add('hidden');

    items.forEach(g => {
        const badge = g.pagador === 'compartido'
            ? `<span class="text-[10px] text-primary font-bold bg-primary/10 px-2 py-0.5 rounded">c/u: ${fmt(g.monto / 2)}</span>`
            : '';
        lista.innerHTML += `
        <div class="bg-surface-container-lowest p-3 rounded-xl border border-outline-variant flex items-center justify-between gap-2">
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center shrink-0">
                    <span class="material-symbols-outlined text-primary text-[20px]">paid</span>
                </div>
                <div class="min-w-0">
                    <p class="font-label-md truncate">${esc(g.concepto)}</p>
                    <p class="text-[10px] text-on-surface-variant uppercase font-bold">${fmtFecha(g.fecha)} · ${nomPagador(g.pagador)}</p>
                    ${badge}
                </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
                <span class="font-bold">${fmt(g.monto)}</span>
                <button onclick="abrirEditar('${g.id}')" class="w-8 h-8 flex items-center justify-center text-on-surface-variant/50 hover:text-primary">
                    <span class="material-symbols-outlined text-[18px]">edit</span>
                </button>
                <button onclick="eliminar('${g.id}')" class="w-8 h-8 flex items-center justify-center text-on-surface-variant/50 hover:text-error">
                    <span class="material-symbols-outlined text-[18px]">delete</span>
                </button>
            </div>
        </div>`;
    });
}

// ─── CAJÓN DE AJUSTES ─────────────────────────────────────────────────────────

window.toggleCajon = function () {
    const cajon    = document.getElementById('cajon');
    const contenido = document.getElementById('cajon-contenido');
    const fondo    = document.getElementById('cajon-fondo');

    if (cajon.classList.contains('hidden')) {
        cajon.classList.remove('hidden', 'pointer-events-none');
        cajon.classList.add('pointer-events-auto');
        setTimeout(() => {
            contenido.classList.remove('-translate-x-full');
            fondo.classList.remove('opacity-0');
            fondo.classList.add('opacity-100');
        }, 10);
    } else {
        contenido.classList.add('-translate-x-full');
        fondo.classList.remove('opacity-100');
        fondo.classList.add('opacity-0');
        setTimeout(() => {
            cajon.classList.add('hidden', 'pointer-events-none');
            cajon.classList.remove('pointer-events-auto');
        }, 300);
    }
};

// ─── GESTIÓN DE DATOS ─────────────────────────────────────────────────────────

window.borrarGastos = function () {
    if (!confirm('¿Borrar todos los gastos? La configuración de usuarios se mantiene.')) return;
    toggleCajon();
    gastos = [];
    guardarLocal();
    renderTodo();
    // Push inmediato para limpiar el Sheet también
    fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'push', gastos: [], config })
    }).catch(e => console.warn('[SpendSync]', e));
};

window.resetearApp = function () {
    if (!confirm('⚠️ ¿Resetear la aplicación?\n\nSe borrarán usuarios y gastos del Sheet y del dispositivo. Necesitarás configurar de nuevo.')) return;
    // Limpiar Sheet en segundo plano
    fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'reset' })
    }).catch(() => {});
    // Limpiar local
    config  = null;
    gastos  = [];
    usuario = null;
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('ss_reset', '1');
    mostrarVista('setup-view');
    document.getElementById('setup-form').reset();
};

// ─── SINCRONIZACIÓN ───────────────────────────────────────────────────────────

function schedulePush() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushASheet, 2000);
}

async function pushASheet() {
    try {
        setSyncUI(true);
        await fetch(GAS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'push', gastos, config })
        });
        localStorage.setItem('ss_lastSync', new Date().toISOString());
        actualizarLabelSync();
    } catch (e) {
        console.warn('[SpendSync] Push falló:', e);
    } finally {
        setSyncUI(false);
    }
}

async function pullDeSheet() {
    const res  = await fetch(GAS_URL);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Error del servidor');
    return json;
}

async function pullSilencioso() {
    try {
        const r = await pullDeSheet();
        if (!r.config) return;
        config = r.config;
        gastos = normalizarGastos(r.gastos || []);
        guardarLocal();
        if (usuario) renderTodo(); // solo actualizar si ya está en la app
        localStorage.setItem('ss_lastSync', new Date().toISOString());
        actualizarLabelSync();
    } catch { /* sin conexión */ }
}

window.syncManual = async function () {
    if (sincroni) return;
    setSyncUI(true);
    try {
        // Primero subir los cambios locales, luego bajar el Sheet
        await fetch(GAS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'push', gastos, config })
        });
        const r = await pullDeSheet();
        if (r.config) {
            config = r.config;
            gastos = normalizarGastos(r.gastos || []);
            guardarLocal();
            renderTodo();
        }
        localStorage.setItem('ss_lastSync', new Date().toISOString());
        actualizarLabelSync();
    } catch (e) {
        console.warn('[SpendSync] Sync falló:', e);
    } finally {
        setSyncUI(false);
    }
};

function setSyncUI(activo) {
    sincroni = activo;
    const btn  = document.getElementById('sync-btn');
    const icono = btn.querySelector('.sync-icon');
    if (activo) {
        btn.classList.add('opacity-70');
        icono.classList.add('spinning');
    } else {
        btn.classList.remove('opacity-70');
        icono.classList.remove('spinning');
    }
}

function actualizarLabelSync() {
    const el = document.getElementById('last-sync-label');
    if (!el) return;
    const ts = localStorage.getItem('ss_lastSync');
    el.textContent = ts
        ? 'Última sync: ' + new Date(ts).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
        : 'Auto-sync activo';
}

// ─── UTILIDADES ───────────────────────────────────────────────────────────────

function guardarLocal() {
    localStorage.setItem('ss_config', JSON.stringify(config));
    localStorage.setItem('ss_gastos',  JSON.stringify(gastos));
}

function normalizarGastos(arr) {
    return arr
        .map(g => ({
            id:       String(g.id || ''),
            fecha:    extraerFecha(g.fecha),
            concepto: String(g.concepto || ''),
            monto:    Number(g.monto) || 0,
            pagador:  ['1','2','compartido'].includes(String(g.pagador)) ? String(g.pagador) : '1',
            tipo:     ['gasto','pendiente'].includes(String(g.tipo)) ? String(g.tipo) : 'gasto'
        }))
        .filter(g => g.id); // descartar filas sin ID
}

function extraerFecha(v) {
    const m = String(v || '').match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : new Date().toISOString().substring(0, 10);
}

function fmt(n) {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(n);
}

function fmtFecha(s) {
    const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return s;
    return new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`)
        .toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}

function nomPagador(p) {
    if (!config) return p;
    if (p === '1') return config.nombre1;
    if (p === '2') return config.nombre2;
    return 'Compartido';
}

function porFecha(a, b) { return b.fecha.localeCompare(a.fecha); }

function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function v(id) { return document.getElementById(id).value; }

// ─── SERVICE WORKER ───────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(e => console.warn('[SW]', e));
    });
}

// ─── INICIO ───────────────────────────────────────────────────────────────────

initApp();
