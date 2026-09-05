const API_BASE = '/api';

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  const months = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
  return `${months[parseInt(m) - 1]} ${y}`;
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── State ───
let state = {
  currentMonth: monthKey(new Date()),
  people: [],
  loading: false,
  error: null,
};

let currentFilter = 'all';
let currentSearch = '';

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
const exportBtn = $('#exportData');
const receiptModal = $('#receiptModal');
const receiptImage = $('#receiptImage');
const loadingEl = $('#loadingIndicator');

// ─── API ───
async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    throw new Error('Sem conexão com o servidor.');
  }

  let data = null;
  try {
    data = await res.json();
  } catch {}

  if (!res.ok) {
    if (res.status === 413) throw new Error('Arquivo muito grande. Tente uma imagem ou foto menor.');
    throw new Error(data?.error || `Erro inesperado do servidor (${res.status}).`);
  }
  return data;
}

// ─── Load people from server ───
async function loadPeople() {
  state.loading = true;
  state.error = null;
  render();

  try {
    const data = await api(`/people?month=${state.currentMonth}`);
    state.people = data.people;
    state.loading = false;
    render();
  } catch (err) {
    state.loading = false;
    state.error = err.message;
    render();
  }
}

// ─── Render ───
function render() {
  monthTitle.textContent = monthLabel(state.currentMonth);

  const total = state.people.length;
  const paid = state.people.filter((p) => p.paid).length;
  const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
  stats.textContent = `${paid}/${total} pagos (${pct}%)`;

  if (state.loading) {
    loadingEl.classList.add('show');
    peopleList.innerHTML = '';
    emptyState.classList.remove('show');
    return;
  }

  loadingEl.classList.remove('show');

  if (state.error) {
    peopleList.innerHTML = '';
    emptyState.classList.add('show');
    emptyState.querySelector('p').textContent = `Erro: ${state.error}`;
    emptyState.querySelector('.empty-icon').textContent = '⚠️';
    return;
  }

  let filtered = [...state.people];

  if (currentFilter === 'paid') {
    filtered = filtered.filter((p) => p.paid);
  } else if (currentFilter === 'unpaid') {
    filtered = filtered.filter((p) => !p.paid);
  }

  if (currentSearch.trim()) {
    const q = currentSearch.trim().toLowerCase();
    filtered = filtered.filter((p) => p.name.toLowerCase().includes(q));
  }

  filtered.sort((a, b) => {
    if (a.paid !== b.paid) return a.paid ? 1 : -1;
    return a.name.localeCompare(b.name, 'pt-BR');
  });

  if (filtered.length === 0) {
    peopleList.innerHTML = '';
    emptyState.classList.add('show');
    emptyState.querySelector('p').textContent = total === 0
      ? 'Nenhuma pessoa cadastrada neste mês.'
      : 'Nenhum resultado encontrado.';
    emptyState.querySelector('.empty-icon').textContent = '📋';
    return;
  }

  emptyState.classList.remove('show');
  peopleList.innerHTML = filtered.map((p) => renderRow(p)).join('');
}

function renderRow(person) {
  const paidClass = person.paid ? 'paid' : 'unpaid';
  const paidLabel = person.paid ? '✅ Pago' : '⬜ Pendente';

  let receiptHTML = '';
  if (person.receipt) {
    receiptHTML = `
      <div style="position:relative;display:inline-flex;align-items:center;gap:4px">
        <img
          class="receipt-preview"
          src="${person.receipt.data}"
          alt="Comprovante"
          data-id="${person.id}"
          data-action="view-receipt"
        />
        <button
          class="receipt-remove-btn"
          data-id="${person.id}"
          data-action="remove-receipt"
          title="Remover comprovante"
        >&times;</button>
      </div>
    `;
  } else {
    receiptHTML = `
      <label class="receipt-label" data-id="${person.id}">
        📎 Anexar
        <input
          type="file"
          class="receipt-input"
          accept="image/*,video/*"
          data-id="${person.id}"
        />
      </label>
    `;
  }

  return `
    <tr>
      <td class="col-name" data-label="Nome">
        <span class="person-name">${escapeHTML(person.name)}</span>
      </td>
      <td class="col-status" data-label="Status">
        <button
          class="status-badge ${paidClass}"
          data-id="${person.id}"
          data-action="toggle-paid"
        >${paidLabel}</button>
      </td>
      <td class="col-receipt" data-label="Comprovante">
        <div class="receipt-cell">${receiptHTML}</div>
      </td>
      <td class="col-date" data-label="Data">
        <span class="date-cell">${formatDate(person.paidAt)}</span>
      </td>
      <td class="col-actions" data-label="Ações" style="text-align:center">
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

// ─── Actions ───
async function addPerson(name) {
  addBtn.disabled = true;
  const id = (crypto.randomUUID && crypto.randomUUID()) || `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const temp = { id, name, paid: false, paidAt: null, receipt: null };
  state.people.push(temp);
  nameInput.value = '';
  render();
  try {
    const created = await api('/people', {
      method: 'POST',
      body: JSON.stringify({ name, month: state.currentMonth }),
    });
    const idx = state.people.findIndex((p) => p.id === temp.id);
    const person = {
      id: created.id,
      name: created.name,
      paid: false,
      paidAt: null,
      receipt: null,
    };
    if (idx !== -1) state.people[idx] = person;
    else state.people.push(person);
    render();
  } catch (err) {
    state.people = state.people.filter((p) => p.id !== temp.id);
    render();
    alert(err.message);
  } finally {
    addBtn.disabled = false;
    nameInput.focus();
  }
}

const FREE_NAMES = ['mikael lorran natali'];

async function togglePaid(id) {
  const person = state.people.find((p) => p.id === id);
  if (!person) return;

  if (!person.paid && !person.receipt && !FREE_NAMES.includes(person.name.toLowerCase())) {
    alert('Anexe o print do seu comprovante');
    return;
  }

  const prev = { paid: person.paid, paidAt: person.paidAt };
  person.paid = !prev.paid;
  person.paidAt = person.paid ? new Date().toISOString().split('T')[0] : null;
  render();

  try {
    const res = await api(`/people/${id}/toggle`, { method: 'PATCH' });
    const cur = state.people.find((p) => p.id === id);
    if (cur) {
      cur.paid = res.paid;
      cur.paidAt = res.paidAt || null;
      render();
    }
  } catch (err) {
    const cur = state.people.find((p) => p.id === id);
    if (cur) {
      cur.paid = prev.paid;
      cur.paidAt = prev.paidAt;
    }
    render();
    alert(err.message);
  }
}

async function deletePerson(id) {
  if (!confirm('Remover esta pessoa?')) return;
  const idx = state.people.findIndex((p) => p.id === id);
  if (idx === -1) return;
  const [removed] = state.people.splice(idx, 1);
  render();
  try {
    await api(`/people/${id}`, { method: 'DELETE' });
  } catch (err) {
    state.people.push(removed);
    render();
    alert(err.message);
  }
}

async function handleReceiptUpload(id, file) {
  const person = state.people.find((p) => p.id === id);
  if (!person) return;

  const isImage = file && file.type.startsWith('image/');
  const isVideo = file && file.type.startsWith('video/');
  if (!isImage && !isVideo) {
    alert('Arquivo inválido. Envie uma imagem ou um print (vídeo).');
    return;
  }

  const prevReceipt = person.receipt;
  let data;
  let fileName = file.name;

  try {
    if (isVideo) {
      data = await videoToImage(file);
      if (!/\.jpe?g$/i.test(fileName)) fileName += '.jpg';
    } else {
      data = await compressImage(file);
      if (/\.heic$/i.test(fileName)) fileName = fileName.replace(/\.heic$/i, '.jpg');
    }
  } catch (err) {
    alert(err.message);
    return;
  }
  if (!data) {
    alert('Não foi possível processar o arquivo.');
    return;
  }

  person.receipt = { data, name: fileName };
  render();

  try {
    const res = await api(`/people/${id}/receipt`, {
      method: 'PATCH',
      body: JSON.stringify({ data, name: fileName }),
    });
    const cur = state.people.find((p) => p.id === id);
    if (cur) cur.receipt = res.receipt;
    render();
  } catch (err) {
    const cur = state.people.find((p) => p.id === id);
    if (cur) cur.receipt = prevReceipt || undefined;
    render();
    alert(err.message);
  }
}

function finalizeImage(canvas, ctx, img, w, h, fileType) {
  const MAX_SMALL = 800;
  const SMALL_Q = 0.6;
  let type = 'image/jpeg';
  if (fileType === 'image/png' && hasTransparency(ctx, w, h)) {
    type = 'image/png';
  }
  let dataUrl = canvas.toDataURL(type, type === 'image/png' ? undefined : 0.72);

  if (dataUrl.length > 3500000) {
    const scale = Math.min(1, MAX_SMALL / Math.max(w, h));
    const w2 = Math.max(1, Math.round(w * scale));
    const h2 = Math.max(1, Math.round(h * scale));
    canvas.width = w2;
    canvas.height = h2;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w2, h2);
    ctx.drawImage(img, 0, 0, w2, h2);
    dataUrl = canvas.toDataURL('image/jpeg', SMALL_Q);
  }
  return dataUrl;
}

function compressImage(file) {
  const MAX_DIM = 1000;
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Não foi possível processar a imagem.');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(finalizeImage(canvas, ctx, img, w, h, file.type));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler a imagem.'));
    };
    img.src = url;
  });
}

function videoToImage(file) {
  const MAX_DIM = 1000;
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    let settled = false;

    const cleanup = () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    };
    const done = (resolveFn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveFn(value);
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    setTimeout(() => fail(new Error('Não foi possível ler o vídeo.')), 8000);

    video.onerror = () => fail(new Error('Não foi possível ler o vídeo.'));
    video.onloadedmetadata = () => {
      const t = Math.min(0.1, (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0.4) / 4);
      video.currentTime = t;
    };
    video.onseeked = () => {
      try {
        const vw = video.videoWidth || 1;
        const vh = video.videoHeight || 1;
        const scale = Math.min(1, MAX_DIM / Math.max(vw, vh));
        const w = Math.max(1, Math.round(vw * scale));
        const h = Math.max(1, Math.round(vh * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Não foi possível processar o vídeo.');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(video, 0, 0, w, h);
        done(resolve, finalizeImage(canvas, ctx, video, w, h, 'image/jpeg'));
      } catch (err) {
        fail(err);
      }
    };
    video.src = url;
  });
}

function hasTransparency(ctx, w, h) {
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) return true;
    }
  } catch {}
  return false;
}

async function removeReceipt(id) {
  if (!confirm('Remover comprovante?')) return;
  const person = state.people.find((p) => p.id === id);
  if (!person) return;
  const prev = person.receipt;
  person.receipt = null;
  render();
  try {
    await api(`/people/${id}/receipt`, { method: 'DELETE' });
  } catch (err) {
    if (person) person.receipt = prev || undefined;
    render();
    alert(err.message);
  }
}

async function navigateMonth(direction) {
  const [y, m] = state.currentMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + direction, 1);
  state.currentMonth = monthKey(d);
  await loadPeople();
}

async function exportData() {
  try {
    const res = await fetch(`${API_BASE}/export?month=${state.currentMonth}`);
    if (!res.ok) {
      let msg = `Erro ${res.status}`;
      try {
        const err = await res.json();
        if (err.error) msg = err.error;
      } catch {}
      throw new Error(msg);
    }
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `assinaturas-${state.currentMonth}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  }
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
  else if (action === 'remove-receipt') removeReceipt(id);
});

peopleList.addEventListener('change', (e) => {
  const input = e.target.closest('.receipt-input');
  if (!input || !input.files.length) return;
  const id = input.dataset.id;
  const file = input.files[0];
  input.value = '';
  handleReceiptUpload(id, file);
});

// ─── Form ───
addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (name) addPerson(name);
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
loadPeople();
