// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────

const GAS_URL = 'https://script.google.com/macros/s/AKfycbwEVnRw5npVWcO7EI8u5lS2KbHeq5dYlh_41wHl1ZugSNq7gdpSaOiIRO1ek8Rlb-Tr/exec';

// ─── CATEGORÍAS BASE ──────────────────────────────────────────────────────────

const CATEGORIAS_BASE = [
    { id: 'comida',         nombre: 'Comida',         icono: 'restaurant',        color: '#e67e22' },
    { id: 'supermercado',   nombre: 'Supermercado',   icono: 'shopping_cart',     color: '#27ae60' },
    { id: 'bencina',        nombre: 'Bencina',         icono: 'local_gas_station', color: '#c0392b' },
    { id: 'arriendo',       nombre: 'Arriendo',        icono: 'home',              color: '#8e44ad' },
    { id: 'entretencion',   nombre: 'Entretención',    icono: 'theaters',          color: '#2980b9' },
    { id: 'salud',          nombre: 'Salud',           icono: 'favorite',          color: '#e91e63' },
    { id: 'servicios',      nombre: 'Servicios',       icono: 'bolt',              color: '#f39c12' },
    { id: 'ropa',           nombre: 'Ropa',            icono: 'checkroom',         color: '#16a085' },
    { id: 'transporte',     nombre: 'Transporte',      icono: 'directions_bus',    color: '#2c3e50' },
    { id: 'tecnologia',     nombre: 'Tecnología',      icono: 'devices',           color: '#1abc9c' },
    { id: 'otras',          nombre: 'Otras',           icono: 'category',          color: '#95a5a6' },
];

// ─── ESTADO ───────────────────────────────────────────────────────────────────

let config     = JSON.parse(localStorage.getItem('ss_config')      || 'null');
let gastos     = JSON.parse(localStorage.getItem('ss_gastos')       || '[]');
let categorias = JSON.parse(localStorage.getItem('ss_categorias')   || 'null');
let usuario = null;   // '1' o '2'
let pagSel  = '1';    // payer seleccionado en formulario
let editId  = null;   // id del gasto en edición
let editPag = '1';    // payer en modal de edición
let filtroCategoria = null; // filtro activo en historial
let editCat = '';     // categoría seleccionada en modal editar
let syncTimer     = null;
let sincroni      = false;
let pullListo     = false; // impide push antes de que el primer pull complete
let sinConexion   = !navigator.onLine;
let pendientePush = localStorage.getItem('ss_pendiente_push') === 'true';

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
    if (localStorage.getItem('ss_reset')) {
        localStorage.removeItem('ss_reset');
        pullListo = true; // sin datos previos, no hay riesgo de push vacío
        mostrarVista('setup-view');
        return;
    }

    const sesion = sessionStorage.getItem('ss_usuario');

    if (config) {
        // Mostrar UI inmediatamente con datos locales, pull en segundo plano
        if (sesion) { usuario = sesion; lanzarApp(); } else mostrarLogin();
        // pullListo permanece false hasta que el pull termine → schedulePush bloqueado
        await pullSilencioso();
        return;
    }

    // Sin config local → pull bloqueante antes de mostrar cualquier cosa
    bootLoader(true);
    try {
        const r = await pullDeSheet();
        bootLoader(false);
        if (r.config) {
            config = r.config;
            gastos = normalizarGastos(r.gastos || []);
            if (Array.isArray(r.categorias) && r.categorias.length) categorias = r.categorias;
            guardarLocal();
            pullListo = true;
            if (sesion) { usuario = sesion; lanzarApp(); } else mostrarLogin();
        } else {
            pullListo = true;
            mostrarVista('setup-view');
        }
    } catch {
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
        pullListo = true; // cuenta nueva, no hay pull que esperar
        await pushASheet();
        mostrarAlerta('setup-alert', '¡Configuración guardada! Ambos dispositivos quedarán sincronizados.', true);
        setTimeout(() => { sessionStorage.setItem('ss_usuario', '1'); usuario = '1'; lanzarApp(); }, 1200);
    } catch (err) {
        mostrarAlerta('setup-alert', 'Guardado local. Sin conexión al Sheet: ' + err.message);
        btn.textContent = 'Continuar sin conexión';
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
    renderGestionCats();
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
    const esPropuesta = !!usuario && pagSel !== usuario;
    const wrap  = document.getElementById('pendiente-wrap');
    const hint  = document.getElementById('propuesta-hint');
    const texto = document.getElementById('propuesta-hint-texto');
    if (wrap) wrap.classList.toggle('hidden', esPropuesta);
    if (hint) hint.classList.toggle('hidden', !esPropuesta);
    if (texto && config && esPropuesta) {
        const otroNombre = config['nombre' + (usuario === '1' ? '2' : '1')];
        texto.textContent = `${otroNombre} recibirá este movimiento para confirmar.`;
    }
}

let formCat = ''; // categoría seleccionada en formulario nuevo

document.getElementById('gasto-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const monto = +v('monto').replace(/\D/g, '');
    if (!monto) return;

    const esPropuesta = !!usuario && pagSel !== usuario;
    gastos.push({
        id:        Date.now().toString(),
        fecha:     v('fecha'),
        concepto:  v('concepto').trim(),
        monto,
        pagador:   pagSel,
        categoria: formCat,
        tipo:      esPropuesta
                     ? `propuesto_${usuario}`
                     : (document.getElementById('es-pendiente').checked ? 'pendiente' : 'gasto')
    });

    guardarLocal();
    schedulePush();
    formCat = '';
    this.reset();
    document.getElementById('fecha').valueAsDate = new Date();
    document.getElementById('es-pendiente').checked = false;
    document.getElementById('concepto').focus();
    seleccionarPagador('1');
    renderFormCatSelector();
    renderTodo();
    if (esPropuesta) {
        const otroNombre = config['nombre' + (usuario === '1' ? '2' : '1')];
        mostrarToast(`Enviado a ${otroNombre} para confirmar`);
    }
});

// ─── ACCIONES SOBRE GASTOS ────────────────────────────────────────────────────

// ─── AYUDA CONTEXTUAL ─────────────────────────────────────────────────────────

const AYUDAS = {
    pagador: {
        titulo: '¿Quién paga?',
        html: `<p class="text-on-surface-variant mb-3">Define quién corre con el gasto:</p>
<div class="space-y-3">
  <div class="flex gap-3 p-3 bg-surface-container rounded-xl">
    <span class="material-symbols-outlined text-primary shrink-0">person</span>
    <div><p class="font-bold">Solo un usuario</p><p class="text-sm text-on-surface-variant mt-0.5">El gasto lo paga esa persona sola y suma únicamente a su total individual.</p></div>
  </div>
  <div class="flex gap-3 p-3 bg-surface-container rounded-xl">
    <span class="material-symbols-outlined text-primary shrink-0">group</span>
    <div><p class="font-bold">50/50 (compartido)</p><p class="text-sm text-on-surface-variant mt-0.5">El gasto se divide en partes iguales. La mitad se suma al total de cada persona.</p></div>
  </div>
</div>`
    },
    pendiente: {
        titulo: 'Gasto vs Pendiente',
        html: `<p class="text-on-surface-variant mb-3">Hay dos tipos de movimiento:</p>
<div class="space-y-3">
  <div class="flex gap-3 p-3 bg-surface-container rounded-xl">
    <span class="material-symbols-outlined text-secondary shrink-0">paid</span>
    <div><p class="font-bold">Gasto</p><p class="text-sm text-on-surface-variant mt-0.5">Ya fue pagado. Queda en el historial y suma al total general.</p></div>
  </div>
  <div class="flex gap-3 p-3 bg-surface-container rounded-xl">
    <span class="material-symbols-outlined text-tertiary shrink-0">pending_actions</span>
    <div><p class="font-bold">Pendiente</p><p class="text-sm text-on-surface-variant mt-0.5">Todavía no se pagó. Aparece arriba hasta que se salde. Se puede abonar en partes o pagar todo de una vez.</p></div>
  </div>
</div>`
    },
    resumen: {
        titulo: 'Resumen de gastos',
        html: `<div class="space-y-3">
  <div class="flex gap-3 p-3 bg-surface-container rounded-xl">
    <span class="material-symbols-outlined text-primary shrink-0">account_balance_wallet</span>
    <div><p class="font-bold">Total gastado</p><p class="text-sm text-on-surface-variant mt-0.5">Suma de todos los gastos ya pagados. No incluye los pendientes.</p></div>
  </div>
  <div class="flex gap-3 p-3 bg-surface-container rounded-xl">
    <span class="material-symbols-outlined text-primary shrink-0">person</span>
    <div><p class="font-bold">Total por persona</p><p class="text-sm text-on-surface-variant mt-0.5">Cuánto gastó cada uno. En gastos 50/50 la mitad se suma al total de cada persona.</p></div>
  </div>
  <div class="flex gap-3 p-3 bg-surface-container rounded-xl">
    <span class="material-symbols-outlined text-error shrink-0">pending_actions</span>
    <div><p class="font-bold">Pendiente por persona</p><p class="text-sm text-on-surface-variant mt-0.5">Monto que esa persona todavía tiene que pagar. Desaparece cuando el pendiente se salda.</p></div>
  </div>
</div>`
    },
    pendientes: {
        titulo: 'Cómo pagar pendientes',
        html: `<div class="space-y-3">
  <div class="flex gap-3 p-3 bg-surface-container rounded-xl">
    <span class="material-symbols-outlined text-secondary shrink-0">check_circle</span>
    <div><p class="font-bold">Pendiente individual</p><p class="text-sm text-on-surface-variant mt-0.5">Tocá <em>Marcar pagado</em>. Podés escribir un monto menor para abonar solo una parte — el resto queda como nuevo pendiente.</p></div>
  </div>
  <div class="flex gap-3 p-3 bg-surface-container rounded-xl">
    <span class="material-symbols-outlined text-secondary shrink-0">payments</span>
    <div><p class="font-bold">Pendiente 50/50</p><p class="text-sm text-on-surface-variant mt-0.5">Cada persona paga su parte de forma independiente tocando su propio botón. Si pagás menos de tu mitad, queda pendiente la diferencia para vos.</p></div>
  </div>
</div>`
    },
    sync: {
        titulo: 'Sincronización',
        html: `<div class="space-y-3">
  <div class="flex gap-3 p-3 bg-surface-container rounded-xl">
    <span class="material-symbols-outlined text-primary shrink-0">cloud_sync</span>
    <div><p class="font-bold">Automática</p><p class="text-sm text-on-surface-variant mt-0.5">Cada vez que registrás, editás o eliminás un movimiento, los datos se suben a Google Sheets en pocos segundos.</p></div>
  </div>
  <div class="flex gap-3 p-3 bg-surface-container rounded-xl">
    <span class="material-symbols-outlined text-primary shrink-0">sync</span>
    <div><p class="font-bold">Botón Sincronizar</p><p class="text-sm text-on-surface-variant mt-0.5">Descarga los últimos datos del Sheet al instante. Usalo si el otro usuario acaba de hacer cambios desde otro dispositivo.</p></div>
  </div>
</div>`
    },
    datos: {
        titulo: 'Gestión de datos',
        html: `<div class="space-y-3">
  <div class="flex gap-3 p-3 bg-surface-container rounded-xl">
    <span class="material-symbols-outlined text-error shrink-0">delete_sweep</span>
    <div><p class="font-bold">Borrar todos los gastos</p><p class="text-sm text-on-surface-variant mt-0.5">Elimina todos los movimientos (gastos y pendientes) del historial. La configuración de usuarios se mantiene intacta.</p></div>
  </div>
  <div class="flex gap-3 p-3 bg-surface-container rounded-xl">
    <span class="material-symbols-outlined text-error shrink-0">restart_alt</span>
    <div><p class="font-bold">Resetear aplicación</p><p class="text-sm text-on-surface-variant mt-0.5">Borra absolutamente todo: usuarios, gastos y configuración, tanto en el dispositivo como en Google Sheets. Tendrás que configurar la app de cero.</p></div>
  </div>
</div>`
    },
    setup_pin: {
        titulo: 'Usuarios y acceso',
        html: `<div class="space-y-3">
  <div class="flex gap-3 p-3 bg-surface-container rounded-xl">
    <span class="material-symbols-outlined text-primary shrink-0">pin</span>
    <div><p class="font-bold">PIN de 4 dígitos</p><p class="text-sm text-on-surface-variant mt-0.5">Protege el ingreso a la app. Cada usuario tiene el suyo propio y lo ingresa al abrir la app.</p></div>
  </div>
  <div class="flex gap-3 p-3 bg-surface-container rounded-xl">
    <span class="material-symbols-outlined text-primary shrink-0">badge</span>
    <div><p class="font-bold">RUT</p><p class="text-sm text-on-surface-variant mt-0.5">Se usa solo para recuperar tu PIN si lo olvidás. No se comparte ni se envía a ningún servicio externo.</p></div>
  </div>
  <div class="flex gap-3 p-3 bg-surface-container rounded-xl">
    <span class="material-symbols-outlined text-primary shrink-0">devices</span>
    <div><p class="font-bold">Multidispositivo</p><p class="text-sm text-on-surface-variant mt-0.5">La configuración se guarda en Google Sheets y está disponible en cualquier dispositivo. Solo se configura una vez.</p></div>
  </div>
</div>`
    }
};

window.mostrarAyuda = function (clave) {
    const h = AYUDAS[clave];
    if (!h) return;
    document.getElementById('ayuda-titulo').textContent = h.titulo;
    document.getElementById('ayuda-contenido').innerHTML = h.html;
    document.getElementById('ayuda-modal').classList.remove('hidden');
};

window.cerrarAyuda = function (e) {
    if (e.target === document.getElementById('ayuda-modal')) {
        document.getElementById('ayuda-modal').classList.add('hidden');
    }
};

// ─── PAGO DE PENDIENTE ────────────────────────────────────────────────────────

let pagoId  = null;
let pagoUsr = '1';

window.abrirPago = function (id, quienPaga) {
    const g = gastos.find(x => x.id === id);
    if (!g) return;
    pagoId = id;

    const es50  = g.pagador === 'compartido';
    const mitad = Math.round(g.monto / 2);

    document.getElementById('pago-titulo').textContent = es50
        ? `Pago de ${quienPaga === '1' ? config.nombre1 : config.nombre2} (50/50)`
        : 'Registrar pago';
    document.getElementById('pago-concepto').textContent = g.concepto;
    document.getElementById('pago-quien').classList.toggle('hidden', !es50);

    if (es50) {
        document.getElementById('pago-btn-u1').textContent = config.nombre1;
        document.getElementById('pago-btn-u2').textContent = config.nombre2;
        seleccionarPagoUsr(quienPaga || usuario || '1');
        document.getElementById('pago-hint').textContent = `Mitad a pagar: ${fmt(mitad)} de ${fmt(g.monto)} total`;
        document.getElementById('pago-monto').value = new Intl.NumberFormat('es-CL').format(mitad);
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
    editCat = g.categoria || '';
    document.getElementById('edit-concepto').value = g.concepto;
    document.getElementById('edit-monto').value = new Intl.NumberFormat('es-CL').format(g.monto);
    document.getElementById('edit-fecha').value  = g.fecha;
    document.getElementById('edit-pendiente').checked = g.tipo === 'pendiente';
    document.getElementById('edit-btn-pag-1').textContent = config.nombre1;
    document.getElementById('edit-btn-pag-2').textContent = config.nombre2;
    seleccionarEditPagador(g.pagador);
    renderEditCatSelector();
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
        concepto:  v('edit-concepto').trim(),
        monto:     +v('edit-monto').replace(/\D/g, ''),
        fecha:     v('edit-fecha'),
        tipo:      document.getElementById('edit-pendiente').checked ? 'pendiente' : 'gasto',
        pagador:   editPag,
        categoria: editCat
    };
    guardarLocal();
    schedulePush();
    renderTodo();
    cerrarEditar();
});

// ─── CATEGORÍAS UI ────────────────────────────────────────────────────────────

function renderSelectorCat(containerId, selectedId, onSelect) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const cats = categoriasEfectivas();
    el.innerHTML = cats.map(c => {
        const sel = c.id === selectedId;
        return `<button type="button" onclick="__catSel('${containerId}','${c.id}')"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all shrink-0 ${sel ? 'border-primary text-primary bg-primary/10' : 'border-outline-variant text-on-surface-variant'}"
            style="${sel ? `border-color:${c.color};color:${c.color};background:${c.color}20` : ''}">
            <span class="material-symbols-outlined text-[14px]">${c.icono}</span>${esc(c.nombre)}
        </button>`;
    }).join('');
    el._onSelect = onSelect;
}

window.__catSel = function (containerId, id) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (containerId === 'cat-selector') {
        formCat = formCat === id ? '' : id;
        renderFormCatSelector();
    } else if (containerId === 'edit-cat-selector') {
        editCat = editCat === id ? '' : id;
        renderEditCatSelector();
    } else if (containerId === 'filtro-cat') {
        filtroCategoria = filtroCategoria === id ? null : id;
        renderFiltroBar();
        renderHistorial();
        renderEstadisticas();
    }
};

function renderFormCatSelector() {
    renderSelectorCat('cat-selector', formCat, null);
}

function renderEditCatSelector() {
    renderSelectorCat('edit-cat-selector', editCat, null);
}

function renderFiltroBar() {
    const el = document.getElementById('filtro-cat');
    if (!el) return;
    const cats = categoriasEfectivas();
    const usadas = new Set(gastos.filter(g => g.tipo === 'gasto' && g.categoria).map(g => g.categoria));
    const visibles = cats.filter(c => usadas.has(c.id));
    const wrap = document.getElementById('filtro-cat-wrap');
    if (visibles.length === 0) { wrap && wrap.classList.add('hidden'); return; }
    wrap && wrap.classList.remove('hidden');
    el.innerHTML = visibles.map(c => {
        const sel = filtroCategoria === c.id;
        return `<button type="button" onclick="__catSel('filtro-cat','${c.id}')"
            class="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold border transition-all shrink-0 ${sel ? 'border-primary text-on-primary' : 'border-outline-variant text-on-surface-variant'}"
            style="${sel ? `background:${c.color};border-color:${c.color};color:#fff` : ''}">
            <span class="material-symbols-outlined text-[13px]">${c.icono}</span>${esc(c.nombre)}
        </button>`;
    }).join('');
}

function catBadge(catId) {
    if (!catId) return '';
    const c = getCat(catId);
    if (!c) return '';
    return `<span class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
        style="background:${c.color}20;color:${c.color}">
        <span class="material-symbols-outlined text-[11px]">${c.icono}</span>${esc(c.nombre)}
    </span>`;
}

// ─── RENDER ───────────────────────────────────────────────────────────────────

function renderTodo() {
    renderResumen();
    renderPropuestos();
    renderPendientes();
    renderHistorial();
    renderFiltroBar();
    renderEstadisticas();
    renderFormCatSelector();
}

function renderResumen() {
    let t1 = 0, t2 = 0, tc = 0, p1 = 0, p2 = 0;
    gastos.forEach(g => {
        if (g.tipo === 'propuesto_1' || g.tipo === 'propuesto_2') return;
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
        const es50  = g.pagador === 'compartido';
        const mitad = Math.round(g.monto / 2);
        const badge = es50
            ? `<span class="text-[10px] text-primary font-bold bg-primary/10 px-2 py-0.5 rounded">Cada uno: ${fmt(mitad)}</span>`
            : '';

        const botonesAccion = es50
            ? `<button onclick="abrirPago('${g.id}','1')" class="flex-1 h-9 bg-secondary text-on-secondary text-xs font-bold rounded-lg flex items-center justify-center gap-1 active:scale-95 px-2 min-w-0">
                   <span class="material-symbols-outlined text-sm shrink-0">payments</span>
                   <span class="truncate">${esc(config.nombre1)}</span>
               </button>
               <button onclick="abrirPago('${g.id}','2')" class="flex-1 h-9 bg-secondary text-on-secondary text-xs font-bold rounded-lg flex items-center justify-center gap-1 active:scale-95 px-2 min-w-0">
                   <span class="material-symbols-outlined text-sm shrink-0">payments</span>
                   <span class="truncate">${esc(config.nombre2)}</span>
               </button>`
            : `<button onclick="abrirPago('${g.id}')" class="flex-1 h-9 bg-secondary text-on-secondary text-xs font-bold rounded-lg flex items-center justify-center gap-1 active:scale-95">
                   <span class="material-symbols-outlined text-sm">check_circle</span>Marcar pagado
               </button>`;

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
                ${botonesAccion}
                <button onclick="abrirEditar('${g.id}')" class="w-9 h-9 border border-primary text-primary rounded-lg flex items-center justify-center active:scale-95 shrink-0">
                    <span class="material-symbols-outlined text-sm">edit</span>
                </button>
                <button onclick="eliminar('${g.id}')" class="w-9 h-9 border border-error text-error rounded-lg flex items-center justify-center active:scale-95 shrink-0">
                    <span class="material-symbols-outlined text-sm">delete</span>
                </button>
            </div>
        </div>`;
    });
}

function renderHistorial() {
    const lista = document.getElementById('lista-gastos');
    const vacio = document.getElementById('vacio-gastos');
    let items = gastos.filter(g => g.tipo === 'gasto').sort(porFecha);
    if (filtroCategoria) items = items.filter(g => g.categoria === filtroCategoria);
    lista.innerHTML = '';

    if (!items.length) { vacio.classList.remove('hidden'); return; }
    vacio.classList.add('hidden');

    const cat = filtroCategoria ? getCat(filtroCategoria) : null;
    const iconoCat = (g) => {
        const c = getCat(g.categoria);
        return c
            ? `<span class="material-symbols-outlined text-[20px]" style="color:${c.color}">${c.icono}</span>`
            : `<span class="material-symbols-outlined text-primary text-[20px]">paid</span>`;
    };

    items.forEach(g => {
        const badge50 = g.pagador === 'compartido'
            ? `<span class="text-[10px] text-primary font-bold bg-primary/10 px-2 py-0.5 rounded">c/u: ${fmt(g.monto / 2)}</span>`
            : '';
        lista.innerHTML += `
        <div class="bg-surface-container-lowest p-3 rounded-xl border border-outline-variant flex items-center justify-between gap-2">
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center shrink-0">
                    ${iconoCat(g)}
                </div>
                <div class="min-w-0">
                    <p class="font-label-md truncate">${esc(g.concepto)}</p>
                    <p class="text-[10px] text-on-surface-variant uppercase font-bold">${fmtFecha(g.fecha)} · ${nomPagador(g.pagador)}</p>
                    <div class="flex flex-wrap gap-1 mt-0.5">${badge50}${catBadge(g.categoria)}</div>
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

// ─── ESTADÍSTICAS ─────────────────────────────────────────────────────────────

function renderEstadisticas() {
    const el = document.getElementById('seccion-estadisticas');
    if (!el) return;

    const gastosPagados = gastos.filter(g => g.tipo === 'gasto');
    if (!gastosPagados.length) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');

    // Por categoría
    const porCat = {};
    gastosPagados.forEach(g => {
        const cid = g.categoria || 'otras';
        porCat[cid] = (porCat[cid] || 0) + g.monto;
    });
    const totalGasto = gastosPagados.reduce((s, g) => s + g.monto, 0);
    const catOrdenadas = Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxCat = catOrdenadas[0]?.[1] || 1;

    const barrasCat = catOrdenadas.map(([cid, monto]) => {
        const c = getCat(cid) || { nombre: cid, icono: 'category', color: '#95a5a6' };
        const pct = Math.round((monto / maxCat) * 100);
        const pctTotal = Math.round((monto / totalGasto) * 100);
        return `<div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-[16px] shrink-0" style="color:${c.color}">${c.icono}</span>
            <div class="flex-1 min-w-0">
                <div class="flex justify-between text-[11px] mb-0.5">
                    <span class="font-bold truncate">${esc(c.nombre)}</span>
                    <span class="text-on-surface-variant shrink-0 ml-1">${fmt(monto)} <span class="opacity-60">(${pctTotal}%)</span></span>
                </div>
                <div class="h-2 bg-surface-container rounded-full overflow-hidden">
                    <div class="h-full rounded-full transition-all" style="width:${pct}%;background:${c.color}"></div>
                </div>
            </div>
        </div>`;
    }).join('');

    // Mes actual
    const ahora = new Date();
    const mesKey = `${ahora.getFullYear()}-${String(ahora.getMonth()+1).padStart(2,'0')}`;
    const gastosEsteMes = gastosPagados.filter(g => g.fecha && g.fecha.startsWith(mesKey));
    const totalMes = gastosEsteMes.reduce((s, g) => s + g.monto, 0);
    const mesMostrar = ahora.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });

    // Por persona (solo gastos tipo gasto)
    let t1 = 0, t2 = 0;
    gastosPagados.forEach(g => {
        if (g.pagador === '1') t1 += g.monto;
        else if (g.pagador === '2') t2 += g.monto;
        else { t1 += g.monto / 2; t2 += g.monto / 2; }
    });
    const maxP = Math.max(t1, t2, 1);

    document.getElementById('stats-mes-label').textContent = mesMostrar;
    document.getElementById('stats-mes-total').textContent = fmt(totalMes);
    document.getElementById('stats-total').textContent = fmt(totalGasto);
    document.getElementById('stats-barras-cat').innerHTML = barrasCat;

    const pct1 = Math.round((t1 / maxP) * 100);
    const pct2 = Math.round((t2 / maxP) * 100);
    document.getElementById('stats-n1').textContent = config?.nombre1 || 'U1';
    document.getElementById('stats-n2').textContent = config?.nombre2 || 'U2';
    document.getElementById('stats-t1').textContent = fmt(t1);
    document.getElementById('stats-t2').textContent = fmt(t2);
    document.getElementById('stats-bar1').style.width = pct1 + '%';
    document.getElementById('stats-bar2').style.width = pct2 + '%';
}

// ─── GESTIÓN DE CATEGORÍAS ────────────────────────────────────────────────────

window.agregarCategoria = function () {
    const nombre = (document.getElementById('nueva-cat-nombre').value || '').trim();
    if (!nombre) return;
    const cats = categoriasEfectivas().filter(c => !CATEGORIAS_BASE.find(b => b.id === c.id));
    const id = 'custom_' + Date.now();
    const nuevas = [...cats, { id, nombre, icono: 'label', color: '#3525cd' }];
    categorias = [...CATEGORIAS_BASE, ...nuevas];
    document.getElementById('nueva-cat-nombre').value = '';
    guardarLocal();
    pushCategorias();
    renderGestionCats();
    renderFormCatSelector();
    renderFiltroBar();
};

window.eliminarCategoria = function (id) {
    if (CATEGORIAS_BASE.find(c => c.id === id)) return;
    categorias = categoriasEfectivas().filter(c => c.id !== id);
    guardarLocal();
    pushCategorias();
    renderGestionCats();
    renderFormCatSelector();
    renderFiltroBar();
};

function renderGestionCats() {
    const el = document.getElementById('lista-cats-custom');
    if (!el) return;
    const custom = categoriasEfectivas().filter(c => !CATEGORIAS_BASE.find(b => b.id === c.id));
    el.innerHTML = custom.length ? custom.map(c => `
        <div class="flex items-center gap-2 py-1">
            <span class="material-symbols-outlined text-sm" style="color:${c.color}">${c.icono}</span>
            <span class="flex-1 text-sm">${esc(c.nombre)}</span>
            <button onclick="eliminarCategoria('${c.id}')" class="w-7 h-7 flex items-center justify-center text-error rounded-lg hover:bg-error/10">
                <span class="material-symbols-outlined text-[16px]">delete</span>
            </button>
        </div>`).join('')
    : '<p class="text-xs text-on-surface-variant">Sin categorías personalizadas.</p>';
}

async function pushCategorias() {
    try {
        await fetch(GAS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'pushCategorias', categorias: categoriasEfectivas() })
        });
    } catch (e) { console.warn('[GastosComunes] Push categorías falló:', e); }
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
    filtroCategoria = null;
    guardarLocal();
    renderTodo();
    // Push inmediato para limpiar el Sheet también
    fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'push', gastos: [], config })
    }).catch(e => console.warn('[GastosComunes]', e));
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
    if (!pullListo) return; // nunca subir al Sheet antes de haber bajado
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
        pendientePush = false;
        localStorage.removeItem('ss_pendiente_push');
        localStorage.setItem('ss_lastSync', new Date().toISOString());
        actualizarLabelSync();
    } catch (e) {
        pendientePush = true;
        localStorage.setItem('ss_pendiente_push', 'true');
        console.warn('[GastosComunes] Push falló:', e);
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
        if (r.config) {
            config = r.config;
            gastos = normalizarGastos(r.gastos || []);
            if (Array.isArray(r.categorias) && r.categorias.length) categorias = r.categorias;
            guardarLocal();
            if (usuario) renderTodo();
            localStorage.setItem('ss_lastSync', new Date().toISOString());
            actualizarLabelSync();
        }
    } catch { /* sin conexión */ } finally {
        pullListo = true;
    }
}

window.syncManual = async function () {
    if (sincroni) return;
    setSyncUI(true);
    try {
        // Solo pull: el Sheet es la fuente de verdad.
        // Los cambios locales ya se subieron vía schedulePush al hacerlos.
        const r = await pullDeSheet();
        if (r.config) {
            config = r.config;
            gastos = normalizarGastos(r.gastos || []);
            if (Array.isArray(r.categorias) && r.categorias.length) categorias = r.categorias;
            guardarLocal();
            renderTodo();
        }
        localStorage.setItem('ss_lastSync', new Date().toISOString());
        actualizarLabelSync();
    } catch (e) {
        console.warn('[GastosComunes] Sync falló:', e);
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
        ? 'Última sincronización: ' + new Date(ts).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
        : 'Sincronización activa';
}

// ─── UTILIDADES ───────────────────────────────────────────────────────────────

function guardarLocal() {
    localStorage.setItem('ss_config',     JSON.stringify(config));
    localStorage.setItem('ss_gastos',      JSON.stringify(gastos));
    localStorage.setItem('ss_categorias',  JSON.stringify(categorias));
}

function categoriasEfectivas() {
    return categorias && categorias.length ? categorias : CATEGORIAS_BASE;
}

function getCat(id) {
    return categoriasEfectivas().find(c => c.id === id) || null;
}

function normalizarGastos(arr) {
    return arr
        .map(g => ({
            id:        String(g.id || ''),
            fecha:     extraerFecha(g.fecha),
            concepto:  String(g.concepto || ''),
            monto:     Number(g.monto) || 0,
            pagador:   ['1','2','compartido'].includes(String(g.pagador)) ? String(g.pagador) : '1',
            tipo:      ['gasto','pendiente','propuesto_1','propuesto_2'].includes(String(g.tipo)) ? String(g.tipo) : 'gasto',
            categoria: String(g.categoria || '')
        }))
        .filter(g => g.id);
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

// ─── PROPUESTAS (movimientos por confirmar) ───────────────────────────────────

function renderPropuestos() {
    const seccion = document.getElementById('seccion-propuestos');
    if (!seccion || !usuario) { if (seccion) seccion.classList.add('hidden'); return; }

    const otroUsr = usuario === '1' ? '2' : '1';
    const items   = gastos.filter(g => g.tipo === `propuesto_${otroUsr}`).sort(porFecha);
    seccion.classList.toggle('hidden', items.length === 0);

    const badge = document.getElementById('badge-propuestos');
    if (badge) badge.textContent = items.length || '';

    const lista = document.getElementById('lista-propuestos');
    lista.innerHTML = '';
    items.forEach(g => {
        const otroNombre = esc(config['nombre' + otroUsr]);
        lista.innerHTML += `
        <div class="bg-surface-container-lowest p-4 rounded-2xl border-l-4 border-primary shadow-sm">
            <div class="flex justify-between items-start mb-1">
                <div class="min-w-0 mr-3">
                    <p class="font-bold text-on-surface truncate">${esc(g.concepto)}</p>
                    <p class="text-xs text-on-surface-variant">${fmtFecha(g.fecha)} · ${nomPagador(g.pagador)}</p>
                    <p class="text-xs text-primary font-bold mt-1">Propuesto por ${otroNombre}</p>
                </div>
                <span class="font-bold text-headline-md shrink-0">${fmt(g.monto)}</span>
            </div>
            <div class="flex gap-2 mt-3">
                <button onclick="confirmarPropuesto('${g.id}','gasto')"
                    class="flex-1 h-9 bg-secondary text-on-secondary text-xs font-bold rounded-lg flex items-center justify-center gap-1 active:scale-95">
                    <span class="material-symbols-outlined text-sm">check_circle</span>Gasto
                </button>
                <button onclick="confirmarPropuesto('${g.id}','pendiente')"
                    class="flex-1 h-9 border-2 border-tertiary text-tertiary text-xs font-bold rounded-lg flex items-center justify-center gap-1 active:scale-95">
                    <span class="material-symbols-outlined text-sm">schedule</span>Pendiente
                </button>
                <button onclick="rechazarPropuesto('${g.id}')"
                    class="w-9 h-9 border border-error text-error rounded-lg flex items-center justify-center active:scale-95 shrink-0">
                    <span class="material-symbols-outlined text-sm">close</span>
                </button>
            </div>
        </div>`;
    });
}

window.confirmarPropuesto = function (id, tipo) {
    const g = gastos.find(x => x.id === id);
    if (!g) return;
    g.tipo = tipo;
    guardarLocal();
    schedulePush();
    renderTodo();
    mostrarToast(tipo === 'gasto' ? 'Confirmado como gasto' : 'Confirmado como pendiente');
};

window.rechazarPropuesto = function (id) {
    if (!confirm('¿Rechazar este movimiento?')) return;
    gastos = gastos.filter(x => x.id !== id);
    guardarLocal();
    schedulePush();
    renderTodo();
};

// ─── OFFLINE / RECONEXIÓN ─────────────────────────────────────────────────────

function actualizarBannerConexion() {
    const banner = document.getElementById('offline-banner');
    if (banner) banner.classList.toggle('hidden', !sinConexion);
}

window.addEventListener('offline', () => {
    sinConexion = true;
    actualizarBannerConexion();
});

window.addEventListener('online', async () => {
    sinConexion = false;
    actualizarBannerConexion();
    if (pendientePush && pullListo) {
        mostrarToast('Reconectado — enviando cambios…');
        try { await pushASheet(); mostrarToast('Cambios enviados'); } catch {}
    }
});

function mostrarToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('opacity-0', 'translate-y-2');
    el.classList.add('opacity-100', 'translate-y-0');
    clearTimeout(el._t);
    el._t = setTimeout(() => {
        el.classList.add('opacity-0', 'translate-y-2');
        el.classList.remove('opacity-100', 'translate-y-0');
    }, 2800);
}

// ─── SERVICE WORKER ───────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(e => console.warn('[SW]', e));
    });
}

// ─── INICIO ───────────────────────────────────────────────────────────────────

initApp();
