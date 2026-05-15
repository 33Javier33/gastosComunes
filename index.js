// ─── 1. CONSTANTS & STATE ────────────────────────────────────────────────────

const GAS_URL = 'https://script.google.com/macros/s/AKfycbwEVnRw5npVWcO7EI8u5lS2KbHeq5dYlh_41wHl1ZugSNq7gdpSaOiIRO1ek8Rlb-Tr/exec';

let authData             = JSON.parse(localStorage.getItem('authData'));
let expenses             = JSON.parse(localStorage.getItem('sharedExpenses')) || [];
let selectedLoginUser    = '1';
let currentPayerSelection = '1';
let editPayerSelection   = '1';
let editExpenseId        = null;
let autoSyncTimer        = null;
let isSyncing            = false;

// Auto-logout when tab is hidden (security)
document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
        sessionStorage.removeItem('isLoggedIn');
        sessionStorage.removeItem('currentUser');
        if (authData) location.reload();
    }
});

// ─── 2. VIEW ROUTING ─────────────────────────────────────────────────────────

function showView(viewId) {
    document.querySelectorAll('section[id$="-view"]').forEach(v => {
        v.classList.add('hidden');
        v.classList.remove('flex', 'block');
    });
    const target = document.getElementById(viewId);
    target.classList.remove('hidden');
    target.classList.add(viewId === 'main-view' ? 'block' : 'flex');

    document.querySelectorAll('[id$="-alert"]').forEach(a => {
        a.classList.add('hidden');
        a.textContent = '';
        a.className = a.className.replace('text-secondary', 'text-error');
    });
}

function showAlert(elementId, message, isInfo = false) {
    const el = document.getElementById(elementId);
    el.textContent = message;
    el.classList.remove('hidden');
    if (isInfo) {
        el.classList.remove('text-error');
        el.classList.add('text-secondary');
    } else {
        el.classList.remove('text-secondary');
        el.classList.add('text-error');
    }
}

// ─── 3. BOOT ─────────────────────────────────────────────────────────────────

async function initApp() {
    if (authData) {
        if (sessionStorage.getItem('isLoggedIn')) {
            launchMainApp();
        } else {
            showLoginView();
        }
        return;
    }

    // No local config — try to pull from Google Sheets first
    showBootLoader(true);
    try {
        const remote = await pullFromSheet();
        if (remote.authData) {
            authData = remote.authData;
            localStorage.setItem('authData', JSON.stringify(authData));
            if (remote.expenses && remote.expenses.length) {
                expenses = remote.expenses.filter(e => !e.deleted);
                persistExpenses();
            }
            showBootLoader(false);
            showLoginView();
        } else {
            showBootLoader(false);
            showView('setup-view');
        }
    } catch {
        showBootLoader(false);
        showView('setup-view');
    }
}

function showBootLoader(show) {
    document.getElementById('boot-loader').classList.toggle('hidden', !show);
}

function showLoginView() {
    document.getElementById('lbl-login-u1').textContent = authData.p1Name;
    document.getElementById('btn-login-u1').querySelector('span.material-symbols-outlined').textContent = authData.p1Name.charAt(0).toUpperCase();
    document.getElementById('lbl-login-u2').textContent = authData.p2Name;
    document.getElementById('btn-login-u2').querySelector('span.material-symbols-outlined').textContent = authData.p2Name.charAt(0).toUpperCase();
    selectLoginUser('1');
    showView('login-view');
}

// ─── 4. SETUP ────────────────────────────────────────────────────────────────

document.getElementById('setup-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const p1Name = document.getElementById('setup-name1').value.trim();
    const p1Pin  = document.getElementById('setup-pin1').value;
    const p1Rut  = document.getElementById('setup-rut1').value.trim();
    const p2Name = document.getElementById('setup-name2').value.trim();
    const p2Pin  = document.getElementById('setup-pin2').value;
    const p2Rut  = document.getElementById('setup-rut2').value.trim();

    if (p1Pin.length !== 4 || p2Pin.length !== 4) {
        showAlert('setup-alert', 'Los PINs deben tener 4 dígitos.');
        return;
    }

    authData = { p1Name, p1Pin, p1Rut, p2Name, p2Pin, p2Rut };
    localStorage.setItem('authData', JSON.stringify(authData));
    sessionStorage.setItem('isLoggedIn', 'true');
    sessionStorage.setItem('currentUser', '1');

    try { await pushToSheet(); } catch (err) { console.warn('[SpendSync] Setup sync failed:', err); }

    launchMainApp();
});

// ─── 5. LOGIN ────────────────────────────────────────────────────────────────

function selectLoginUser(userStr) {
    selectedLoginUser = userStr;
    const btn1 = document.getElementById('btn-login-u1');
    const btn2 = document.getElementById('btn-login-u2');

    if (userStr === '1') {
        btn1.classList.replace('border-outline-variant', 'border-primary');
        btn1.classList.add('border-2');
        btn2.classList.replace('border-primary', 'border-outline-variant');
        btn2.classList.remove('border-2');
    } else {
        btn2.classList.replace('border-outline-variant', 'border-primary');
        btn2.classList.add('border-2');
        btn1.classList.replace('border-primary', 'border-outline-variant');
        btn1.classList.remove('border-2');
    }
}

document.getElementById('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const pin = document.getElementById('login-pin').value;
    const correctPin = selectedLoginUser === '1' ? authData.p1Pin : authData.p2Pin;

    if (pin === correctPin) {
        sessionStorage.setItem('isLoggedIn', 'true');
        sessionStorage.setItem('currentUser', selectedLoginUser);
        document.getElementById('login-pin').value = '';
        launchMainApp();
    } else {
        showAlert('login-alert', 'PIN incorrecto. Intenta de nuevo.');
        document.getElementById('login-pin').value = '';
    }
});

// ─── 6. PIN RECOVERY ─────────────────────────────────────────────────────────

document.getElementById('recovery-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const rut = document.getElementById('recovery-rut').value.trim();
    if (rut === authData.p1Rut) {
        showAlert('recovery-alert', `Hola ${authData.p1Name}, tu PIN es: ${authData.p1Pin}`, true);
    } else if (rut === authData.p2Rut) {
        showAlert('recovery-alert', `Hola ${authData.p2Name}, tu PIN es: ${authData.p2Pin}`, true);
    } else {
        showAlert('recovery-alert', 'El RUT no coincide con los registros.');
    }
});

// ─── 7. LOGOUT ───────────────────────────────────────────────────────────────

window.logout = function () {
    sessionStorage.removeItem('isLoggedIn');
    sessionStorage.removeItem('currentUser');
    initApp();
};

// ─── 8. MAIN APP ─────────────────────────────────────────────────────────────

function launchMainApp() {
    showView('main-view');
    document.getElementById('date').valueAsDate = new Date();

    const currentUser = sessionStorage.getItem('currentUser');
    const myName = currentUser === '1' ? authData.p1Name : authData.p2Name;

    document.getElementById('current-user-name').textContent = `Hola, ${myName}`;
    document.getElementById('current-user-initial').textContent = myName.charAt(0).toUpperCase();

    document.getElementById('btn-payer-1').textContent = authData.p1Name;
    document.getElementById('btn-payer-2').textContent = authData.p2Name;
    document.getElementById('lbl-total1-name').textContent = `${authData.p1Name} Pagó`;
    document.getElementById('lbl-total2-name').textContent = `${authData.p2Name} Pagó`;
    document.getElementById('lbl-pending1').textContent = authData.p1Name;
    document.getElementById('lbl-pending2').textContent = authData.p2Name;

    selectPayer('1');
    renderExpenses();
    updateSummary();
    updateLastSyncLabel();

    // Silent pull in background to get any changes from the other device
    silentPull();
}

function updateLastSyncLabel() {
    const el = document.getElementById('last-sync-label');
    if (!el) return;
    const ts = localStorage.getItem('lastSync');
    if (ts) {
        const d = new Date(ts);
        el.textContent = `Última sync: ${d.toLocaleDateString('es-CL')} ${d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`;
    } else {
        el.textContent = 'Auto-sync activo. Los cambios se envían solos.';
    }
}

// ─── 9. ADD EXPENSE FORM ─────────────────────────────────────────────────────

document.getElementById('amount').addEventListener('input', function () {
    const v = this.value.replace(/\D/g, '');
    this.value = v ? new Intl.NumberFormat('es-CL').format(parseInt(v)) : '';
});

function selectPayer(val) {
    currentPayerSelection = val;
    ['btn-payer-1', 'btn-payer-2', 'btn-payer-3'].forEach((id, i) => {
        const btn = document.getElementById(id);
        btn.className = String(i + 1) === val
            ? 'h-10 text-xs font-bold rounded-lg border border-primary text-primary bg-primary-container/10'
            : 'h-10 text-xs font-bold rounded-lg border border-outline-variant text-on-surface-variant bg-transparent';
    });
}

document.getElementById('expense-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const rawAmount = document.getElementById('amount').value.replace(/\D/g, '');
    const now = new Date().toISOString();

    const expense = {
        id: Date.now().toString(),
        type: document.getElementById('expense-is-pending').checked ? 'pending' : 'paid',
        date: document.getElementById('date').value,
        concept: document.getElementById('concept').value.trim(),
        amount: parseFloat(rawAmount),
        paidBy: currentPayerSelection,
        updatedAt: now,
        deleted: false
    };

    expenses.push(expense);
    persistExpenses();
    scheduleAutoSync();

    document.getElementById('concept').value = '';
    document.getElementById('amount').value = '';
    document.getElementById('expense-is-pending').checked = false;
    document.getElementById('concept').focus();

    renderExpenses();
    updateSummary();
});

// ─── 10. EXPENSE ACTIONS ─────────────────────────────────────────────────────

window.markAsPaid = function (id) {
    const idx = expenses.findIndex(e => e.id === id);
    if (idx !== -1) {
        expenses[idx].type = 'paid';
        expenses[idx].updatedAt = new Date().toISOString();
        persistExpenses();
        scheduleAutoSync();
        renderExpenses();
        updateSummary();
    }
};

// Soft-delete: marks as deleted so sync can remove it from the sheet
window.deleteExpense = function (id) {
    if (confirm('¿Seguro que deseas eliminar este movimiento?')) {
        const idx = expenses.findIndex(e => e.id === id);
        if (idx !== -1) {
            expenses[idx].deleted = true;
            expenses[idx].updatedAt = new Date().toISOString();
            persistExpenses();
            scheduleAutoSync();
            renderExpenses();
            updateSummary();
        }
    }
};

window.clearAllExpenses = function () {
    if (!confirm('¿Borrar TODOS los gastos? Esta acción se sincronizará con Google Sheets.')) return;
    const now = new Date().toISOString();
    expenses = expenses.map(e => ({ ...e, deleted: true, updatedAt: now }));
    persistExpenses();
    scheduleAutoSync();
    renderExpenses();
    updateSummary();
    toggleDrawer();
};

window.resetApp = function () {
    if (!confirm('¿Resetear la aplicación completa? Se borrarán usuarios y todos los gastos locales.')) return;
    localStorage.clear();
    sessionStorage.clear();
    location.reload();
};

function persistExpenses() {
    localStorage.setItem('sharedExpenses', JSON.stringify(expenses));
}

// ─── 11. EDIT MODAL ──────────────────────────────────────────────────────────

document.getElementById('edit-amount').addEventListener('input', function () {
    const v = this.value.replace(/\D/g, '');
    this.value = v ? new Intl.NumberFormat('es-CL').format(parseInt(v)) : '';
});

window.openEditModal = function (id) {
    const exp = expenses.find(e => e.id === id);
    if (!exp) return;

    editExpenseId = id;
    document.getElementById('edit-id').value = id;
    document.getElementById('edit-concept').value = exp.concept;
    document.getElementById('edit-amount').value = new Intl.NumberFormat('es-CL').format(exp.amount);
    document.getElementById('edit-date').value = exp.date;
    document.getElementById('edit-is-pending').checked = exp.type === 'pending';

    // Label payer buttons with real names
    document.getElementById('edit-btn-payer-1').textContent = authData.p1Name;
    document.getElementById('edit-btn-payer-2').textContent = authData.p2Name;

    selectEditPayer(exp.paidBy);

    document.getElementById('edit-modal').classList.remove('hidden');
};

window.closeEditModal = function () {
    document.getElementById('edit-modal').classList.add('hidden');
    editExpenseId = null;
};

// Close modal when tapping the dark backdrop
window.handleModalBackdrop = function (e) {
    if (e.target === document.getElementById('edit-modal')) closeEditModal();
};

function selectEditPayer(val) {
    editPayerSelection = val;
    ['edit-btn-payer-1', 'edit-btn-payer-2', 'edit-btn-payer-3'].forEach((id, i) => {
        const btn = document.getElementById(id);
        btn.className = String(i + 1) === val
            ? 'h-10 text-xs font-bold rounded-lg border border-primary text-primary bg-primary-container/10'
            : 'h-10 text-xs font-bold rounded-lg border border-outline-variant text-on-surface-variant bg-transparent';
    });
}

document.getElementById('edit-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!editExpenseId) return;

    const idx = expenses.findIndex(exp => exp.id === editExpenseId);
    if (idx === -1) return;

    const rawAmount = document.getElementById('edit-amount').value.replace(/\D/g, '');

    expenses[idx] = {
        ...expenses[idx],
        concept:   document.getElementById('edit-concept').value.trim(),
        amount:    parseFloat(rawAmount),
        date:      document.getElementById('edit-date').value,
        type:      document.getElementById('edit-is-pending').checked ? 'pending' : 'paid',
        paidBy:    editPayerSelection,
        updatedAt: new Date().toISOString()
    };

    persistExpenses();
    scheduleAutoSync();
    renderExpenses();
    updateSummary();
    closeEditModal();
});

// ─── 12. HELPERS ─────────────────────────────────────────────────────────────

const formatCurrency = amount =>
    new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(amount);

const formatDate = dateString =>
    new Date(dateString + 'T00:00:00').toLocaleDateString('es-CL', { year: 'numeric', month: 'short', day: '2-digit' });

function resolvePayerName(val) {
    if (val === '1') return authData.p1Name;
    if (val === '2') return authData.p2Name;
    return '50/50';
}

function activeExpenses() {
    return expenses.filter(e => !e.deleted);
}

// ─── 13. RENDER ──────────────────────────────────────────────────────────────

function renderExpenses() {
    const expenseList = document.getElementById('expense-list');
    const pendingList = document.getElementById('pending-list');
    expenseList.innerHTML = '';
    pendingList.innerHTML = '';
    let hasPaid = false, hasPending = false;

    const sorted = activeExpenses().sort((a, b) => new Date(b.date) - new Date(a.date));

    sorted.forEach(exp => {
        const payerName  = resolvePayerName(exp.paidBy);
        const splitBadge = exp.paidBy === '3'
            ? `<span class="text-[10px] text-primary font-bold bg-primary/10 px-2 py-0.5 rounded mt-1 inline-block">Aporte: ${formatCurrency(exp.amount / 2)} c/u</span>`
            : '';

        if ((exp.type || 'paid') === 'paid') {
            hasPaid = true;
            expenseList.innerHTML += `
            <div class="bg-surface-container-lowest p-3 rounded-xl border border-outline-variant flex items-center justify-between">
                <div class="flex items-center gap-3 min-w-0">
                    <div class="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center shrink-0">
                        <span class="material-symbols-outlined text-primary">paid</span>
                    </div>
                    <div class="min-w-0">
                        <p class="font-label-md text-label-md truncate">${exp.concept}</p>
                        <p class="text-[10px] text-on-surface-variant uppercase font-bold">${formatDate(exp.date)} • ${payerName}</p>
                    </div>
                </div>
                <div class="text-right flex flex-col items-end justify-center shrink-0 ml-2">
                    <div class="flex items-center gap-1">
                        <span class="font-bold text-on-surface">${formatCurrency(exp.amount)}</span>
                        <button onclick="openEditModal('${exp.id}')" class="w-8 h-8 flex items-center justify-center text-on-surface-variant/50 hover:text-primary transition-colors">
                            <span class="material-symbols-outlined text-[18px]">edit</span>
                        </button>
                        <button onclick="deleteExpense('${exp.id}')" class="w-8 h-8 flex items-center justify-center text-on-surface-variant/50 hover:text-error transition-colors">
                            <span class="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                    </div>
                    ${splitBadge}
                </div>
            </div>`;
        } else {
            hasPending = true;
            const pendingSplitBadge = exp.paidBy === '3'
                ? `<span class="text-[10px] text-primary font-bold bg-primary/10 px-2 py-0.5 rounded mt-1 inline-block">Deuda: ${formatCurrency(exp.amount / 2)} c/u</span>`
                : '';
            pendingList.innerHTML += `
            <div class="bg-surface-container-lowest p-4 rounded-2xl border-l-4 border-tertiary shadow-[0px_4px_12px_rgba(0,0,0,0.05)]">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <h4 class="font-bold text-on-surface">${exp.concept}</h4>
                        <p class="text-xs text-on-surface-variant">${formatDate(exp.date)} • Pendiente por ${payerName}</p>
                    </div>
                    <div class="text-right">
                        <span class="font-headline-md text-headline-md text-on-surface block">${formatCurrency(exp.amount)}</span>
                        ${pendingSplitBadge}
                    </div>
                </div>
                <div class="flex gap-2 mt-3">
                    <button onclick="markAsPaid('${exp.id}')" class="flex-1 h-9 bg-secondary text-on-secondary text-xs font-bold rounded-lg flex items-center justify-center gap-1 active:scale-95 transition-transform">
                        <span class="material-symbols-outlined text-sm">check_circle</span>
                        Marcar Pagado
                    </button>
                    <button onclick="openEditModal('${exp.id}')" class="w-9 h-9 border border-primary text-primary rounded-lg flex items-center justify-center active:scale-95 transition-transform">
                        <span class="material-symbols-outlined text-sm">edit</span>
                    </button>
                    <button onclick="deleteExpense('${exp.id}')" class="w-9 h-9 border border-error text-error rounded-lg flex items-center justify-center active:scale-95 transition-transform">
                        <span class="material-symbols-outlined text-sm">delete</span>
                    </button>
                </div>
            </div>`;
        }
    });

    document.getElementById('expense-empty-state').classList.toggle('hidden', hasPaid);
    document.getElementById('pending-empty-state').classList.toggle('hidden', hasPending);
}

// ─── 14. SUMMARY ─────────────────────────────────────────────────────────────

function updateSummary() {
    let totalPaidP1 = 0, totalPaidP2 = 0;
    let totalPendingP1 = 0, totalPendingP2 = 0;
    let sharedPaidTotal = 0;

    activeExpenses().forEach(exp => {
        const half = exp.amount / 2;
        if ((exp.type || 'paid') === 'paid') {
            if (exp.paidBy === '3') { totalPaidP1 += half; totalPaidP2 += half; sharedPaidTotal += exp.amount; }
            else if (exp.paidBy === '1') totalPaidP1 += exp.amount;
            else if (exp.paidBy === '2') totalPaidP2 += exp.amount;
        } else {
            if (exp.paidBy === '3') { totalPendingP1 += half; totalPendingP2 += half; }
            else if (exp.paidBy === '1') totalPendingP1 += exp.amount;
            else if (exp.paidBy === '2') totalPendingP2 += exp.amount;
        }
    });

    document.getElementById('total-expenses').textContent = formatCurrency(totalPaidP1 + totalPaidP2);
    document.getElementById('total-shared-detail').textContent = `Incluye ${formatCurrency(sharedPaidTotal)} en gastos 50/50`;
    document.getElementById('paid-p1').textContent = formatCurrency(totalPaidP1);
    document.getElementById('paid-p2').textContent = formatCurrency(totalPaidP2);
    document.getElementById('pending-p1').textContent = formatCurrency(totalPendingP1);
    document.getElementById('pending-p2').textContent = formatCurrency(totalPendingP2);
}

// ─── 15. DRAWER ──────────────────────────────────────────────────────────────

window.toggleDrawer = function () {
    const drawer   = document.getElementById('side-drawer');
    const content  = document.getElementById('drawer-content');
    const backdrop = document.getElementById('drawer-backdrop');

    if (drawer.classList.contains('hidden')) {
        drawer.classList.remove('hidden');
        drawer.classList.add('pointer-events-auto');
        setTimeout(() => {
            content.classList.remove('-translate-x-full');
            backdrop.classList.remove('opacity-0');
            backdrop.classList.add('opacity-100');
        }, 10);
    } else {
        content.classList.add('-translate-x-full');
        backdrop.classList.remove('opacity-100');
        backdrop.classList.add('opacity-0');
        setTimeout(() => {
            drawer.classList.add('hidden');
            drawer.classList.remove('pointer-events-auto');
        }, 300);
    }
};

// ─── 16. AUTO-SYNC (debounced) ───────────────────────────────────────────────

function scheduleAutoSync() {
    clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(async () => {
        if (isSyncing) { scheduleAutoSync(); return; } // retry if a sync is in progress
        try {
            setSyncUiState(true);
            await pushToSheet();
            const ts = new Date().toISOString();
            localStorage.setItem('lastSync', ts);
            updateLastSyncLabel();
        } catch (err) {
            console.warn('[SpendSync] Auto-sync push failed:', err);
        } finally {
            setSyncUiState(false);
        }
    }, 3000);
}

async function silentPull() {
    try {
        const remote = await pullFromSheet();
        if (remote.authData) {
            authData = remote.authData;
            localStorage.setItem('authData', JSON.stringify(authData));
        }
        mergeExpenses(remote.expenses);
        persistExpenses();
        renderExpenses();
        updateSummary();
        const ts = new Date().toISOString();
        localStorage.setItem('lastSync', ts);
        updateLastSyncLabel();
    } catch {
        // Offline — no action needed
    }
}

// ─── 17. MANUAL SYNC ─────────────────────────────────────────────────────────

window.manualSync = async function () {
    if (isSyncing) return;
    setSyncUiState(true);
    try {
        await pushToSheet();
        const remote = await pullFromSheet();

        if (remote.authData) {
            authData = remote.authData;
            localStorage.setItem('authData', JSON.stringify(authData));
        }
        mergeExpenses(remote.expenses);
        persistExpenses();
        renderExpenses();
        updateSummary();

        const ts = new Date().toISOString();
        localStorage.setItem('lastSync', ts);
        updateLastSyncLabel();
        showDrawerSyncStatus(`Sincronizado a las ${new Date(ts).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}.`, false);
    } catch (err) {
        showDrawerSyncStatus('Error: ' + err.message, true);
        console.error('[SpendSync Sync]', err);
    } finally {
        setSyncUiState(false);
    }
};

// ─── 18. SYNC TRANSPORT ──────────────────────────────────────────────────────

async function pushToSheet() {
    const payload = {
        action:   'push',
        expenses: expenses,   // includes soft-deleted ones so the sheet is updated
        authData: authData
    };
    const res = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`Push HTTP ${res.status}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Push rechazado');
}

async function pullFromSheet() {
    const res = await fetch(`${GAS_URL}?action=pull`, { method: 'GET' });
    if (!res.ok) throw new Error(`Pull HTTP ${res.status}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Pull rechazado');
    return {
        expenses: Array.isArray(json.expenses) ? json.expenses : [],
        authData: json.authData || null
    };
}

/**
 * Merge remote expenses into local using updatedAt timestamp.
 * Local soft-deletes always win (once deleted locally it stays deleted).
 */
function mergeExpenses(remote) {
    const map = new Map(expenses.map(e => [e.id, e]));

    remote.forEach(r => {
        const local = map.get(r.id);
        if (!local) {
            // New expense from another device
            map.set(r.id, r);
        } else if (local.deleted) {
            // Locally deleted — keep deleted regardless of remote
        } else {
            // Both exist — newest updatedAt wins
            const localTs  = new Date(local.updatedAt || 0).getTime();
            const remoteTs = new Date(r.updatedAt || 0).getTime();
            if (remoteTs > localTs) map.set(r.id, r);
        }
    });

    expenses = Array.from(map.values());
}

// ─── 19. SYNC UI ─────────────────────────────────────────────────────────────

function setSyncUiState(loading) {
    isSyncing = loading;
    const btn   = document.getElementById('sync-btn');
    const icon  = btn.querySelector('.sync-icon');
    const txtEl = document.getElementById('sync-status-text');
    const bar   = document.getElementById('sync-status-bar');

    if (loading) {
        btn.classList.add('syncing', 'opacity-70');
        icon.textContent = 'sync';
        txtEl.textContent = 'Syncing…';
        bar.classList.remove('hidden');
    } else {
        btn.classList.remove('syncing', 'opacity-70');
        icon.textContent = 'cloud_done';
        txtEl.textContent = 'Sync';
        bar.classList.add('hidden');
        setTimeout(() => { icon.textContent = 'cloud_sync'; }, 2000);
    }
}

function showDrawerSyncStatus(msg, isError) {
    const el = document.getElementById('drawer-sync-status');
    el.textContent = msg;
    el.classList.remove('hidden', 'text-error', 'text-secondary');
    el.classList.add(isError ? 'text-error' : 'text-secondary');
    setTimeout(() => el.classList.add('hidden'), 4000);
}

// ─── 20. SERVICE WORKER ──────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.warn('[SpendSync SW] Registration failed:', err);
        });
    });
    navigator.serviceWorker.addEventListener('message', e => {
        if (e.data && e.data.type === 'SW_TRIGGER_SYNC') manualSync();
    });
}

// ─── INIT ────────────────────────────────────────────────────────────────────

initApp();
