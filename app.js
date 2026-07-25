const STORAGE_KEY = 'assinaturas-zap-data';

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  const months = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  return `${months[parseInt(m) - 1]} ${y}`;
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// ─── State ───
let state = {
  currentMonth: monthKey(new Date()),
  months: {},
};

let currentFilter = 'all';
let currentSearch = '';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.currentMonth = parsed.currentMonth || monthKey(new Date());
      state.months = parsed.months || {};
    }
  } catch {
    // fallback to defaults
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getMonthData(month) {
  if (!state.months[month]) {
    state.months[month] = { people: [] };
  }
  return state.months[month];
}

// ─── DOM refs ───
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const monthTitle = $('#monthTitle');
const prevBtn = $('#prevMonth');
const nextBtn = $('#nextMonth');
const stats = $('#stats');
const addForm = $('#addForm');
const nameInput = $('#nameInput');
const addBtn = $('#addBtn');
const searchInput = $('#searchInput');
const filterBtns = $$('.filter-btn');
const peopleList = $('#peopleList');
const emptyState = $('#emptyState');
const resetBtn = $('#resetMonth');
const exportBtn = $('#exportData');
const receiptModal = $('#receiptModal');
const receiptImage = $('#receiptImage');

// ─── Render ───
function render() {
  const month = state.currentMonth;
  monthTitle.textContent = monthLabel(month);

  const data = getMonthData(month);
  const people = data.people;

  // Stats
  const total = people.length;
  const paid = people.filter((p) => p.paid).length;
  const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
  stats.textContent = `${paid}/${total} pagos (${pct}%)`;

  // Filter + Search
  let filtered = [...people];

  if (currentFilter === 'paid') {
    filtered = filtered.filter((p) => p.paid);
  } else if (currentFilter === 'unpaid') {
    filtered = filtered.filter((p) => !p.paid);
  }

  if (currentSearch.trim()) {
    const q = currentSearch.trim().toLowerCase();
    filtered = filtered.filter((p) => p.name.toLowerCase().includes(q));
  }

  // Sort: unpaid first, then by name
  filtered.sort((a, b) => {
    if (a.paid !== b.paid) return a.paid ? 1 : -1;
    return a.name.localeCompare(b.name, 'pt-BR');
  });

  // Render rows
  if (filtered.length === 0) {
    peopleList.innerHTML = '';
    emptyState.classList.add('show');
    return;
  }

  emptyState.classList.remove('show');
  peopleList.innerHTML = filtered
    .map((p) => renderRow(p))
    .join('');
}

function renderRow(person) {
  const paidClass = person.paid ? 'paid' : 'unpaid';
  const paidLabel = person.paid ? '✅ Pago' : '⬜ Pendente';

  let receiptHTML = '';
  if (person.receipt) {
    receiptHTML = `
      <img
        class="receipt-preview"
        src="${person.receipt.data}"
        alt="Comprovante"
        data-id="${person.id}"
        data-action="view-receipt"
      />
    `;
  } else {
    receiptHTML = `
      <label class="receipt-label" data-id="${person.id}">
        📎 Anexar
        <input
          type="file"
          class="receipt-input"
          accept="image/*"
          data-id="${person.id}"
        />
      </label>
    `;
  }

  return `
    <tr>
      <td class="col-name">
        <span class="person-name">${escapeHTML(person.name)}</span>
      </td>
      <td class="col-status">
        <button
          class="status-badge ${paidClass}"
          data-id="${person.id}"
          data-action="toggle-paid"
        >${paidLabel}</button>
      </td>
      <td class="col-receipt">
        <div class="receipt-cell">
          ${receiptHTML}
        </div>
      </td>
      <td class="col-date">
        <span class="date-cell">${formatDate(person.paidAt)}</span>
      </td>
      <td class="col-actions" style="text-align:center">
        <button
          class="action-btn"
          data-id="${person.id}"
          data-action="delete"
          title="Remover"
        >🗑️</button>
      </td>
    </tr>
  `;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Actions ───
function addPerson(name) {
  const month = state.currentMonth;
  const data = getMonthData(month);

  const exists = data.people.some(
    (p) => p.name.toLowerCase().trim() === name.toLowerCase().trim()
  );
  if (exists) {
    alert('Esta pessoa já está cadastrada neste mês.');
    return false;
  }

  data.people.push({
    id: uuid(),
    name: name.trim(),
    paid: false,
    receipt: null,
    paidAt: null,
  });

  saveState();
  render();
  return true;
}

function togglePaid(id) {
  const month = state.currentMonth;
  const data = getMonthData(month);
  const person = data.people.find((p) => p.id === id);
  if (!person) return;

  person.paid = !person.paid;
  person.paidAt = person.paid ? todayISO() : null;

  // When marking unpaid, keep the receipt (don't clear it)
  saveState();
  render();
}

function deletePerson(id) {
  const month = state.currentMonth;
  const data = getMonthData(month);
  data.people = data.people.filter((p) => p.id !== id);
  saveState();
  render();
}

function handleReceiptUpload(id, file) {
  const month = state.currentMonth;
  const data = getMonthData(month);
  const person = data.people.find((p) => p.id === id);
  if (!person) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    person.receipt = {
      name: file.name,
      data: e.target.result,
    };
    saveState();
    render();
  };
  reader.readAsDataURL(file);
}

function removeReceipt(id) {
  const month = state.currentMonth;
  const data = getMonthData(month);
  const person = data.people.find((p) => p.id === id);
  if (!person) return;

  person.receipt = null;
  saveState();
  render();
}

function resetMonth() {
  const month = state.currentMonth;
  if (!confirm(`Tem certeza? Todas as pessoas de ${monthLabel(month)} serão removidas.`)) return;

  state.months[month] = { people: [] };
  saveState();
  render();
}

function exportData() {
  const text = generateExportText();
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `assinaturas-${state.currentMonth}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function generateExportText() {
  const month = state.currentMonth;
  const data = getMonthData(month);
  const lines = [
    `=== Assinaturas Zap - ${monthLabel(month)} ===`,
    `Total: ${data.people.length} | Pagos: ${data.people.filter(p => p.paid).length}`,
    '',
    'Nome | Status | Data',
    '-'.repeat(40),
  ];

  for (const p of data.people) {
    const status = p.paid ? '✅ Pago' : '⬜ Pendente';
    const date = p.paidAt ? formatDate(p.paidAt) : '-';
    lines.push(`${p.name} | ${status} | ${date}`);
  }

  return lines.join('\r\n');
}

function navigateMonth(direction) {
  const [y, m] = state.currentMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + direction, 1);
  state.currentMonth = monthKey(d);
  saveState();
  render();
}

function showReceipt(src) {
  receiptImage.src = src;
  receiptModal.classList.add('show');
}

function hideReceipt() {
  receiptModal.classList.remove('show');
  receiptImage.src = '';
}

// ─── Event delegation ───
peopleList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === 'toggle-paid') togglePaid(id);
  else if (action === 'delete') deletePerson(id);
  else if (action === 'view-receipt') showReceipt(btn.src);
});

peopleList.addEventListener('change', (e) => {
  const input = e.target.closest('.receipt-input');
  if (!input || !input.files.length) return;
  handleReceiptUpload(input.dataset.id, input.files[0]);
});

// Also re-render when a receipt is removed via right-click context
peopleList.addEventListener('contextmenu', (e) => {
  const preview = e.target.closest('.receipt-preview');
  if (!preview) return;
  e.preventDefault();
  if (confirm('Remover comprovante?')) {
    removeReceipt(preview.dataset.id);
  }
});

// ─── Form ───
addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;

  addBtn.disabled = true;
  const ok = addPerson(name);
  addBtn.disabled = false;

  if (ok) nameInput.value = '';
  nameInput.focus();
});

// ─── Search ───
searchInput.addEventListener('input', (e) => {
  currentSearch = e.target.value;
  render();
});

// ─── Filters ───
filterBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    filterBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    render();
  });
});

// ─── Navigation ───
prevBtn.addEventListener('click', () => navigateMonth(-1));
nextBtn.addEventListener('click', () => navigateMonth(1));

// ─── Footer ───
resetBtn.addEventListener('click', resetMonth);
exportBtn.addEventListener('click', exportData);

// ─── Modal ───
receiptModal.addEventListener('click', (e) => {
  if (e.target === receiptModal || e.target.classList.contains('modal-close')) {
    hideReceipt();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideReceipt();
});

// ─── Init ───
loadState();
render();
