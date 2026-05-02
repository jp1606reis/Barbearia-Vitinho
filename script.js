// ============================================================
// CONFIGURAÇÃO FIREBASE — REALTIME DATABASE
// ============================================================
const firebaseConfig = {
    apiKey: "AIzaSyAdwGIYxEh_lN_Hz1kbGEVg4g4ZhWin7yA",
    authDomain: "barbearia-vitinho-838c7.firebaseapp.com",
    databaseURL: "https://barbearia-vitinho-838c7-default-rtdb.firebaseio.com",
    projectId: "barbearia-vitinho-838c7",
    storageBucket: "barbearia-vitinho-838c7.firebasestorage.app",
    messagingSenderId: "552500519717",
    appId: "1:552500519717:web:84b423a6088a4b41bc70cc",
    measurementId: "G-XETLMSGTNW"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

let appointments       = [];
let appointmentHistory = [];
let blockedDates       = [];
let blockedTimeSlots   = [];

// ============================================================
// SINCRONIZAÇÃO EM TEMPO REAL — REALTIME DATABASE
// ============================================================

let _domReady = false;
let _pendingDataChange = false;
let _pendingBlockedChange = false;

function _safeDataChange() {
    if (_domReady) { onDataChange(); } else { _pendingDataChange = true; }
}
function _safeBlockedChange() {
    if (_domReady) { onBlockedChange(); } else { _pendingBlockedChange = true; }
}
function _flushPending() {
    _domReady = true;
    if (_pendingDataChange)    { _pendingDataChange = false;    onDataChange(); }
    if (_pendingBlockedChange) { _pendingBlockedChange = false; onBlockedChange(); }
}

// Converte snapshot do Realtime Database em array com a chave incluída
function _snapshotToArray(snapshot) {
    const result = [];
    snapshot.forEach(child => {
        result.push({ key: child.key, ...child.val() });
    });
    return result;
}

function _setConnected(ok) {
    const el = document.getElementById('realtimeIndicator');
    const lb = document.getElementById('realtimeLabel');
    if (!el || !lb) return;
    if (ok) {
        el.className = 'connected';
        lb.textContent = 'Ao vivo';
    } else {
        el.className = 'disconnected';
        lb.textContent = 'Reconectando...';
    }
}

// Monitora o estado da conexão via nó especial do Realtime Database
function _listenConnectionState() {
    db.ref('.info/connected').on('value', snap => {
        _setConnected(snap.val() === true);
    });
}

function _listenAppointments() {
    db.ref('appointments').on('value',
        snapshot => {
            appointments = _snapshotToArray(snapshot);
            _safeDataChange();
        },
        error => console.error('[Firebase] appointments:', error.message)
    );
}

function _listenHistory() {
    db.ref('history').on('value',
        snapshot => {
            appointmentHistory = _snapshotToArray(snapshot);
            _safeDataChange();
        },
        error => console.error('[Firebase] history:', error.message)
    );
}

function _listenBlockedDates() {
    db.ref('blockedDates').on('value',
        snapshot => {
            blockedDates = _snapshotToArray(snapshot);
            _safeBlockedChange();
        },
        error => console.error('[Firebase] blockedDates:', error.message)
    );
}

function _listenBlockedSlots() {
    db.ref('blockedTimeSlots').on('value',
        snapshot => {
            blockedTimeSlots = _snapshotToArray(snapshot);
            _safeBlockedChange();
        },
        error => console.error('[Firebase] blockedTimeSlots:', error.message)
    );
}

_listenConnectionState();
_listenAppointments();
_listenHistory();
_listenBlockedDates();
_listenBlockedSlots();

function onDataChange() {
    const dateInput = document.getElementById('bookingDate');
    if (dateInput && dateInput.value) generateTimeSlots(dateInput.value);
    if (!document.getElementById('adminDashboard').classList.contains('hidden')) {
        renderAdminAppointments();
        updateAllCharts();
        updateCRMTable();
    }
}

function onBlockedChange() {
    const dateInput = document.getElementById('bookingDate');
    if (dateInput && dateInput.value) generateTimeSlots(dateInput.value);
    if (!document.getElementById('adminDashboard').classList.contains('hidden')) {
        renderBlockedDates();
        renderBlockedTimeSlots();
    }
}

// ============================================================
// OPERAÇÕES DE ESCRITA — REALTIME DATABASE
// ============================================================

function db_appointmentPush(data) {
    db.ref('appointments').push({ ...data, createdAt: new Date().toISOString() })
        .catch(e => console.error('[Firebase] add appointment:', e));
}

// ============================================================
// LÓGICA DE NEGÓCIO & UI
// ============================================================

const servicePrices = {
    'Só tesoura': 35,
    'Máquina e tesoura': 30,
    'Máquina e navalha': 25,
    'Somente com pente': 18,
    'Barba desenhada e raspando todo o pé': 15,
    'Pé': 10,
    'Sobrancelha': 5,
    'Lista simples': 2,
    'Pintura de preto': 20,
    'Reflexo': 45
};

let crmAllClients = [];
let weekChart, monthChart, serviceChart, dailyChart, serviceDistributionChart, hourlyChart;

// ============ AUTO-CANCEL LOGIC ============
let _cleanupRunning = false;
async function cleanupPastAppointments() {
    if (_cleanupRunning) return;
    _cleanupRunning = true;
    try {
        const today = new Date().toISOString().split('T')[0];
        const pastApps = appointments.filter(a => a.date < today);
        if (!pastApps.length) { _cleanupRunning = false; return; }

        for (const app of pastApps) {
            try {
                // Verifica se já existe no histórico
                const histSnap = await db.ref('history')
                    .orderByChild('date').equalTo(app.date).once('value');
                let alreadyExists = false;
                histSnap.forEach(child => {
                    const h = child.val();
                    if (h.time === app.time && h.phone === app.phone) alreadyExists = true;
                });
                if (!alreadyExists) {
                    await db.ref('history').push({
                        name: app.name, phone: app.phone, service: app.service,
                        date: app.date, time: app.time, status: 'completed',
                        completedDate: new Date().toISOString()
                    });
                }
                await db.ref('appointments/' + app.key).remove();
            } catch(e) {
                console.error('[Cleanup] Erro ao processar agendamento:', app.key, e);
            }
        }
    } catch(e) {
        console.error('[Cleanup] Erro ao buscar agendamentos passados:', e);
    } finally {
        _cleanupRunning = false;
    }
}
setInterval(cleanupPastAppointments, 3600000);

// ============ NAVIGATION ============
function showSection(section) {
    ['hero', 'client-section', 'services-section'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    if (section === 'client') {
        document.getElementById('client-section').classList.remove('hidden');
        generateTimeSlots(document.getElementById('bookingDate').value);
    }
    if (section === 'services') document.getElementById('services-section').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showHero() {
    ['client-section', 'services-section'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    document.getElementById('hero').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============ DASHBOARD TAB SWITCHING ============
function switchDashboardTab(tab, e) {
    document.querySelectorAll('.dashboard-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.dashboard-tab').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.remove('hidden');
    if (e && e.target) e.target.closest('.dashboard-tab').classList.add('active');
    setTimeout(() => {
        if (tab === 'analytics') {
            [weekChart, monthChart, serviceDistributionChart, hourlyChart].forEach(c => c && c.resize());
        }
    }, 100);
}

// ============ STATS & CHARTS ============
function calculateStats() {
    const today = new Date().toISOString().split('T')[0];
    const activeApps = appointments.filter(a => a.date >= today);
    const uniqueClients = [...new Set(appointments.map(a => a.name))].length;
    const serviceCount = {};
    appointments.forEach(app => { serviceCount[app.service] = (serviceCount[app.service] || 0) + 1; });
    const popularService = Object.keys(serviceCount).length
        ? Object.keys(serviceCount).reduce((a, b) => serviceCount[a] > serviceCount[b] ? a : b)
        : 'Nenhum';
    document.getElementById('activeAppointments').textContent = activeApps.length;
    document.getElementById('uniqueClients').textContent = uniqueClients;
    document.getElementById('popularService').textContent = popularService;
}

function calculateTotalRevenue() {
    const all = [...appointments, ...appointmentHistory];
    const total = all.reduce((sum, app) => sum + (servicePrices[app.service] || 0), 0);
    document.getElementById('totalRevenue').textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
}

function updateAllCharts() {
    calculateStats();
    calculateTotalRevenue();
    updateServiceChart();
    updateDailyChart();
    updateWeekChart();
    updateMonthChart();
    updateServiceDistributionChart();
    updateHourlyChart();
}

const CHART_COLORS = ['#D4A017','#C0C0C0','#F0C040','#888','#A07810','#E8E8E8','#6b6b6b','#b8860b','#d0d0d0','#4a4a4a'];

function updateServiceChart() {
    const data = {};
    [...appointments, ...appointmentHistory].forEach(app => { data[app.service] = (data[app.service] || 0) + (servicePrices[app.service] || 0); });
    const labels = Object.keys(data);
    const values = Object.values(data);
    if (serviceChart) serviceChart.destroy();
    const ctx = document.getElementById('serviceChart');
    if (!ctx) return;
    serviceChart = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: labels.length ? labels : ['Sem dados'], datasets: [{ data: values.length ? values : [1], backgroundColor: CHART_COLORS, borderColor: '#111', borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#aaa', font: { size: 11 } } } } }
    });
}

function updateDailyChart() {
    const data = {};
    appointments.forEach(app => { data[app.date] = (data[app.date] || 0) + 1; });
    const labels = Object.keys(data).sort();
    const values = labels.map(l => data[l]);
    if (dailyChart) dailyChart.destroy();
    const ctx = document.getElementById('dailyChart');
    if (!ctx) return;
    dailyChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels.length ? labels : ['Sem dados'], datasets: [{ label: 'Agendamentos', data: values.length ? values : [0], backgroundColor: '#D4A017' }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, grid: { color: '#222' }, ticks: { color: '#888' } }, x: { grid: { display: false }, ticks: { color: '#888' } } }, plugins: { legend: { display: false } } }
    });
}

function updateWeekChart() {
    const all = [...appointments, ...appointmentHistory];
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    let total = 0;
    all.forEach(app => {
        const d = new Date(app.date);
        if (d >= weekStart && d <= new Date()) total += servicePrices[app.service] || 0;
    });
    document.getElementById('weekRevenue').textContent = `Total: R$ ${total.toFixed(2).replace('.', ',')}`;
}

function updateMonthChart() {
    const all = [...appointments, ...appointmentHistory];
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    let total = 0;
    all.forEach(app => {
        const d = new Date(app.date);
        if (d >= monthStart && d <= new Date()) total += servicePrices[app.service] || 0;
    });
    document.getElementById('monthRevenue').textContent = `Total: R$ ${total.toFixed(2).replace('.', ',')}`;
}

function updateServiceDistributionChart() {
    const data = {};
    [...appointments, ...appointmentHistory].forEach(app => { data[app.service] = (data[app.service] || 0) + 1; });
    const labels = Object.keys(data);
    const values = Object.values(data);
    if (serviceDistributionChart) serviceDistributionChart.destroy();
    const ctx = document.getElementById('serviceDistributionChart');
    if (!ctx) return;
    serviceDistributionChart = new Chart(ctx, {
        type: 'pie',
        data: { labels: labels.length ? labels : ['Sem dados'], datasets: [{ data: values.length ? values : [1], backgroundColor: CHART_COLORS }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#aaa', font: { size: 10 } } } } }
    });
}

function updateHourlyChart() {
    const data = {};
    appointments.forEach(app => { const h = app.time.split(':')[0]; data[h] = (data[h] || 0) + 1; });
    const labels = Object.keys(data).sort();
    const values = labels.map(l => data[l]);
    if (hourlyChart) hourlyChart.destroy();
    const ctx = document.getElementById('hourlyChart');
    if (!ctx) return;
    hourlyChart = new Chart(ctx, {
        type: 'line',
        data: { labels: labels.length ? labels : ['Sem dados'], datasets: [{ label: 'Pico de Horário', data: values.length ? values : [0], borderColor: '#D4A017', tension: 0.4, fill: true, backgroundColor: 'rgba(212,160,23,0.1)' }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, grid: { color: '#222' }, ticks: { color: '#888' } }, x: { grid: { display: false }, ticks: { color: '#888' } } }, plugins: { legend: { display: false } } }
    });
}

// ============ ADMIN ACTIONS ============
function renderAdminAppointments() {
    const container = document.getElementById('adminAppointmentsList');
    container.innerHTML = '';
    const sorted = [...appointments].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    if (!sorted.length) { container.innerHTML = '<div class="text-center py-12 text-gray-500">Nenhum agendamento ativo.</div>'; return; }
    sorted.forEach(app => {
        const div = document.createElement('div');
        div.className = 'stat-card p-5 rounded-2xl flex flex-wrap items-center justify-between gap-4';
        div.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="w-12 h-12 rounded-full bg-gold-dark/20 flex items-center justify-center text-gold font-bold text-xl">${app.name[0].toUpperCase()}</div>
                <div>
                    <h4 class="font-bold text-white">${app.name}</h4>
                    <p class="text-xs text-gray-500"><i class="fa-solid fa-phone mr-1"></i>${app.phone}</p>
                </div>
            </div>
            <div class="flex flex-wrap gap-3 items-center">
                <div class="text-right">
                    <p class="text-sm font-bold text-white">${app.service}</p>
                    <p class="text-xs text-gold"><i class="fa-solid fa-calendar-day mr-1"></i>${app.date} às ${app.time}</p>
                </div>
                <div class="flex gap-2">
                    <button onclick="completeAppointment('${app.key}')" class="bg-green-600/20 hover:bg-green-600 text-green-500 hover:text-white p-2.5 rounded-xl transition"><i class="fa-solid fa-check"></i></button>
                    <button onclick="cancelAppointment('${app.key}')" class="bg-red-600/20 hover:bg-red-600 text-red-500 hover:text-white p-2.5 rounded-xl transition"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>`;
        container.appendChild(div);
    });
}

function completeAppointment(key) {
    const app = appointments.find(a => a.key === key);
    if (!app) return;
    db.ref('history').push({ ...app, status: 'completed', completedDate: new Date().toISOString() })
        .then(() => db.ref('appointments/' + key).remove())
        .catch(e => console.error(e));
}

function cancelAppointment(key) {
    if (confirm('Deseja realmente cancelar este agendamento?')) {
        const app = appointments.find(a => a.key === key);
        if (!app) return;
        db.ref('history').push({ ...app, status: 'cancelled', cancelledDate: new Date().toISOString() })
            .then(() => db.ref('appointments/' + key).remove())
            .catch(e => console.error(e));
    }
}

// ============ CRM ============
function updateCRMTable() {
    const filter = document.getElementById('crmFilter').value;
    const clients = {};
    [...appointments, ...appointmentHistory].forEach(app => {
        if (!clients[app.phone]) clients[app.phone] = { name: app.name, phone: app.phone, visits: 0, services: new Set(), total: 0, history: [] };
        clients[app.phone].visits++;
        clients[app.phone].services.add(app.service);
        clients[app.phone].total += (servicePrices[app.service] || 0);
        clients[app.phone].history.push(app);
    });
    let list = Object.values(clients);
    if (filter === 'frequent') list = list.filter(c => c.visits >= 3);
    else if (filter === 'new') list = list.filter(c => c.visits === 1);
    crmAllClients = list;
    const tbody = document.getElementById('crmTable');
    tbody.innerHTML = '';
    list.sort((a, b) => b.total - a.total).forEach(c => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #222';
        tr.innerHTML = `
            <td class="py-4 px-4 font-bold text-white">${c.name}</td>
            <td class="py-4 px-4 text-gray-400">${c.phone}</td>
            <td class="py-4 px-4 text-center"><span class="bg-gold/10 text-gold px-2 py-1 rounded-lg text-xs font-bold">${c.visits}</span></td>
            <td class="py-4 px-4 text-gray-500 text-xs">${Array.from(c.services).slice(0,2).join(', ')}${c.services.size > 2 ? '...' : ''}</td>
            <td class="py-4 px-4 text-right font-bold text-green-500">R$ ${c.total.toFixed(2)}</td>
            <td class="py-4 px-4"><button onclick="viewCRMDetail('${c.phone}')" class="text-gold hover:underline text-xs">Ver Perfil</button></td>`;
        tbody.appendChild(tr);
    });
}

function viewCRMDetail(phone) {
    const client = crmAllClients.find(c => c.phone === phone);
    if (!client) return;
    document.getElementById('crmDetailName').textContent = client.name;
    document.getElementById('crmDetail').classList.remove('hidden');
    let html = `<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="p-4 rounded-xl bg-black/30 border border-white/5"><p class="text-xs text-gray-500">Total Gasto</p><p class="text-xl font-bold text-green-500">R$ ${client.total.toFixed(2)}</p></div>
        <div class="p-4 rounded-xl bg-black/30 border border-white/5"><p class="text-xs text-gray-500">Visitas</p><p class="text-xl font-bold text-gold">${client.visits}</p></div>
        <div class="p-4 rounded-xl bg-black/30 border border-white/5"><p class="text-xs text-gray-500">Telefone</p><p class="text-xl font-bold text-white">${client.phone}</p></div>
    </div><h5 class="font-bold text-sm mb-3 text-gray-400">Histórico de Serviços</h5><div class="space-y-2">`;
    client.history.sort((a, b) => b.date.localeCompare(a.date)).forEach(h => {
        html += `<div class="flex justify-between items-center p-3 rounded-lg bg-white/5 text-xs">
            <span><b class="text-white">${h.date}</b> - ${h.service}</span>
            <span class="status-badge ${h.status === 'completed' ? 'status-active' : 'status-cancelled'}">${h.status}</span>
        </div>`;
    });
    html += `</div>`;
    document.getElementById('crmDetailContent').innerHTML = html;
    document.getElementById('crmDetail').scrollIntoView({ behavior: 'smooth' });
}

function closeCRMDetail() { document.getElementById('crmDetail').classList.add('hidden'); }

// ============ BLOCKING ============
function blockDate() {
    const date = document.getElementById('blockDate').value;
    if (!date) return;
    db.ref('blockedDates').push({ date, createdAt: new Date().toISOString() });
}

function unblockDate(key) { db.ref('blockedDates/' + key).remove(); }

function renderBlockedDates() {
    const container = document.getElementById('blockedDatesList');
    container.innerHTML = '';
    blockedDates.sort((a, b) => a.date.localeCompare(b.date)).forEach(d => {
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between p-3 rounded-xl bg-red-900/10 border border-red-900/30';
        div.innerHTML = `<span class="text-sm font-bold text-white">${d.date}</span><button onclick="unblockDate('${d.key}')" class="text-red-500 text-xs hover:underline">Remover</button>`;
        container.appendChild(div);
    });
}

function blockTimeSlot() {
    const date = document.getElementById('blockTimeDate').value;
    const time = document.getElementById('blockTimeSlot').value;
    const reason = document.getElementById('blockTimeReason').value;
    if (!date || !time) { alert('Selecione data e horário!'); return; }
    db.ref('blockedTimeSlots').push({ date, time, reason, createdAt: new Date().toISOString() })
        .then(() => { document.getElementById('blockTimeReason').value = ''; });
}

function unblockTimeSlot(key) { db.ref('blockedTimeSlots/' + key).remove(); }

function renderBlockedTimeSlots() {
    const container = document.getElementById('blockedTimeSlotsList');
    container.innerHTML = '';
    const byDate = {};
    blockedTimeSlots.forEach(s => { if (!byDate[s.date]) byDate[s.date] = []; byDate[s.date].push(s); });
    Object.keys(byDate).sort().forEach(date => {
        const dateDiv = document.createElement('div');
        dateDiv.className = 'rounded-xl p-3 mb-2';
        dateDiv.style.background = 'var(--dark-2)';
        dateDiv.innerHTML = `<p class="text-xs font-bold mb-2" style="color: var(--gold);"><i class="fa-solid fa-calendar mr-1"></i>${date}</p>`;
        byDate[date].sort((a, b) => a.time.localeCompare(b.time)).forEach(slot => {
            const row = document.createElement('div');
            row.className = 'flex items-center justify-between py-1 pl-2';
            row.innerHTML = `<div class="flex items-center gap-3"><span class="text-sm font-mono text-white px-2 py-0.5 rounded" style="background: rgba(139,28,28,0.4); border: 1px solid #5b1c1c;">${slot.time}</span><span class="text-xs text-gray-500">${slot.reason || 'Bloqueado'}</span></div><button onclick="unblockTimeSlot('${slot.key}')" class="text-red-500 hover:text-red-400 text-xs font-medium"><i class="fa-solid fa-lock-open mr-1"></i>Liberar</button>`;
            dateDiv.appendChild(row);
        });
        container.appendChild(dateDiv);
    });
}

// ============ WORKING HOURS ============
function saveWorkingHours() {
    const opening = document.getElementById('openingTime') ? document.getElementById('openingTime').value : null;
    const closing  = document.getElementById('closingTime')  ? document.getElementById('closingTime').value  : null;
    if (!opening || !closing) { alert('Preencha os horários!'); return; }
    db.ref('settings/workingHours').set({ opening, closing, updatedAt: new Date().toISOString() })
        .then(() => alert('✅ Horário salvo!'))
        .catch(() => alert('Erro ao salvar.'));
}

function loadWorkingHours() {
    db.ref('settings/workingHours').once('value').then(snap => {
        if (snap.exists()) {
            const data = snap.val();
            const openEl  = document.getElementById('openingTime');
            const closeEl = document.getElementById('closingTime');
            if (openEl  && data.opening) openEl.value  = data.opening;
            if (closeEl && data.closing) closeEl.value = data.closing;
        }
    });
}

// ============ TIME SLOTS GENERATION ============
function isTimePast(date, time) {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    if (date !== today) return date < today;
    const [h, m] = time.split(':').map(Number);
    const slotDate = new Date();
    slotDate.setHours(h, m, 0, 0);
    return now >= slotDate;
}

function generateTimeSlots(date) {
    const container = document.getElementById('timeSlots');
    if (!container) return;
    container.innerHTML = '';
    if (!date) return;
    const selectedDate = new Date(date + 'T00:00:00');
    const dayOfWeek = selectedDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 1) {
        container.innerHTML = '<p class="col-span-full text-center text-red-400 py-4"><i class="fa-solid fa-ban mr-2"></i>Fechado aos domingos e segundas</p>';
        return;
    }
    if (blockedDates.some(item => item.date === date)) {
        container.innerHTML = '<p class="col-span-full text-center text-red-400 py-4"><i class="fa-solid fa-calendar-xmark mr-2"></i>Data bloqueada pelo barbeiro</p>';
        return;
    }
    const times = window.TIME_SLOTS || [
        "09:00","09:40","10:20","11:00","11:40",
        "13:40","14:20","15:00","15:40","16:20",
        "17:00","17:40","18:20","19:00","19:40"
    ];
    times.forEach(time => {
        const isBooked   = appointments.some(a => a.date === date && a.time === time);
        const blockedSlot = blockedTimeSlots.find(s => s.date === date && s.time === time);
        const isBlocked  = !!blockedSlot;
        const isPast     = isTimePast(date, time);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'slot-btn w-full py-3.5 text-sm font-medium rounded-xl border transition-all';
        if (isPast) {
            btn.className += ' past-time';
            btn.textContent = time;
        } else if (isBlocked) {
            btn.className += ' blocked';
            btn.innerHTML = `${time}<br><span style="font-size:9px;opacity:0.7">${blockedSlot.reason || 'Bloqueado'}</span>`;
        } else if (isBooked) {
            btn.className += ' booked';
            btn.textContent = time;
        } else {
            btn.style.cssText = 'border-color: rgba(212,160,23,0.5); color: #D4A017;';
            btn.textContent = time;
            btn.onmouseover = () => { btn.style.background = '#D4A017'; btn.style.color = '#000'; };
            btn.onmouseout  = () => { btn.style.background = '';        btn.style.color = '#D4A017'; };
            btn.onclick = () => selectTime(time, btn);
        }
        container.appendChild(btn);
    });
}

function selectTime(time, element) {
    const name    = document.getElementById('clientName').value.trim();
    const phone   = document.getElementById('clientPhone').value.trim();
    const service = document.getElementById('service').value;
    const date    = document.getElementById('bookingDate').value;
    if (!name || !phone || !service || !date) { alert('❌ Preencha todos os campos antes de escolher o horário.'); return; }
    if (confirm(`Confirmar agendamento para ${time}?`)) {
        saveAppointment(name, phone, service, date, time);
    }
}

function saveAppointment(name, phone, service, date, time) {
    db_appointmentPush({ name, phone, service, date, time, status: 'active' });
    alert(`✅ Agendamento confirmado!`);
    document.getElementById('bookingForm').reset();
    document.getElementById('bookingDate').value = date;
    generateTimeSlots(date);
}

// ============ ADMIN MODAL ============
function showAdminModal() {
    document.getElementById('adminModal').classList.remove('hidden');
    document.getElementById('adminPassword').focus();
}

function closeAdminModal() { document.getElementById('adminModal').classList.add('hidden'); }

function loginAdmin() {
    if (document.getElementById('adminPassword').value === 'barbeiro2026') {
        closeAdminModal();
        document.getElementById('adminDashboard').classList.remove('hidden');
        ['hero', 'client-section', 'services-section'].forEach(id => document.getElementById(id).classList.add('hidden'));
        renderAdminAppointments();
        updateAllCharts();
        updateCRMTable();
        renderBlockedDates();
        renderBlockedTimeSlots();
    } else { alert('Senha incorreta!'); }
}

function logoutAdmin() {
    document.getElementById('adminDashboard').classList.add('hidden');
    document.getElementById('adminPassword').value = '';
    showHero();
}

// ============ MOBILE MENU ============
function toggleMobileMenu() {
    const menu = document.getElementById('mobileMenu');
    const btn  = document.getElementById('hamburgerBtn');
    const isOpen = menu.classList.contains('open');
    if (isOpen) {
        menu.classList.remove('open');
        btn.classList.remove('open');
    } else {
        menu.classList.add('open');
        btn.classList.add('open');
    }
}

function closeMobileMenu() {
    const menu = document.getElementById('mobileMenu');
    const btn  = document.getElementById('hamburgerBtn');
    menu.classList.remove('open');
    btn.classList.remove('open');
}

document.addEventListener('click', function(e) {
    const menu = document.getElementById('mobileMenu');
    const btn  = document.getElementById('hamburgerBtn');
    if (!menu || !btn) return;
    if (!menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.remove('open');
        btn.classList.remove('open');
    }
});

// ============ INITIALIZATION ============
window.onload = () => {
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('bookingDate');
    if (dateInput) {
        dateInput.setAttribute('min', today);
        dateInput.value = today;
        dateInput.addEventListener('change', () => generateTimeSlots(dateInput.value));
    }
    const blockDateInput     = document.getElementById('blockDate');
    if (blockDateInput) blockDateInput.value = today;
    const blockTimeDateInput = document.getElementById('blockTimeDate');
    if (blockTimeDateInput) blockTimeDateInput.value = today;

    generateTimeSlots(today);
    const hero = document.getElementById('hero');
    if (hero) hero.classList.remove('hidden');

    loadWorkingHours();
    _flushPending();
    setTimeout(() => { cleanupPastAppointments(); }, 5000);
    setInterval(() => {
        const currentDate = document.getElementById('bookingDate').value;
        if (currentDate) generateTimeSlots(currentDate);
    }, 60000);
};

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAdminModal(); });

// Hero Carousel
(function () {
    let hi = 1;
    const hn = 5;
    function heroCarTick() {
        for (let k = 1; k <= hn; k++) {
            const el = document.getElementById('heroCarSlide' + k);
            if (!el) continue;
            if (k === hi) { el.classList.remove('opacity-0', 'z-0'); el.classList.add('opacity-100', 'z-10'); }
            else          { el.classList.remove('opacity-100', 'z-10'); el.classList.add('opacity-0', 'z-0'); }
        }
        hi = hi >= hn ? 1 : hi + 1;
    }
    setInterval(heroCarTick, 4500);
})();