import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isVercel = Boolean(process.env.VERCEL);

const DATA_DIR = isVercel
  ? '/tmp/assinaturas-data'
  : join(__dirname, '..', 'data');

const DATA_FILE = join(DATA_DIR, 'db.json');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

let cache = null;

function load() {
  if (cache) return cache;

  if (existsSync(DATA_FILE)) {
    try {
      const raw = readFileSync(DATA_FILE, 'utf-8');
      cache = JSON.parse(raw);
    } catch {
      cache = { people: [] };
    }
  } else {
    cache = { people: [] };
  }

  return cache;
}

function save() {
  try {
    writeFileSync(DATA_FILE, JSON.stringify(cache));
  } catch {
    // Vercel readonly sometimes
  }
}

export function getPeople(month) {
  const data = load();
  return data.people
    .filter((p) => p.month === month)
    .sort((a, b) => {
      if (a.paid !== b.paid) return a.paid ? 1 : -1;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
}

export function addPerson(id, name, month) {
  const data = load();
  data.people.push({
    id,
    month,
    name,
    paid: false,
    receipt_data: null,
    receipt_name: null,
    paid_at: null,
    created_at: new Date().toISOString(),
  });
  save();
}

export function findPerson(month, name) {
  const data = load();
  return data.people.find(
    (p) => p.month === month && p.name.toLowerCase() === name.toLowerCase()
  );
}

export function getPerson(id) {
  const data = load();
  return data.people.find((p) => p.id === id);
}

export function togglePaid(id) {
  const data = load();
  const person = data.people.find((p) => p.id === id);
  if (!person) return null;

  person.paid = !person.paid;
  person.paid_at = person.paid
    ? new Date().toISOString().split('T')[0]
    : null;

  save();
  return { id, paid: person.paid, paidAt: person.paid_at };
}

export function setReceipt(id, data, name) {
  const db = load();
  const person = db.people.find((p) => p.id === id);
  if (!person) return null;

  person.receipt_data = data;
  person.receipt_name = name;
  save();

  return { id, receipt: { data, name } };
}

export function removeReceipt(id) {
  const db = load();
  const person = db.people.find((p) => p.id === id);
  if (!person) return null;

  person.receipt_data = null;
  person.receipt_name = null;
  save();

  return { id, receipt: null };
}

export function deletePerson(id) {
  const db = load();
  const idx = db.people.findIndex((p) => p.id === id);
  if (idx === -1) return false;

  db.people.splice(idx, 1);
  save();
  return true;
}

export function exportMonth(month) {
  const people = getPeople(month);
  const paid = people.filter((p) => p.paid).length;

  const lines = [
    `=== Assinaturas Zap - ${getMonthLabel(month)} ===`,
    `Total: ${people.length} | Pagos: ${paid}`,
    '',
    'Nome | Status | Data',
    '-'.repeat(40),
  ];

  for (const p of people) {
    const status = p.paid ? '✅ Pago' : '⬜ Pendente';
    const date = p.paid_at ? formatDate(p.paid_at) : '-';
    lines.push(`${p.name} | ${status} | ${date}`);
  }

  return lines.join('\r\n');
}

function getMonthLabel(key) {
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
