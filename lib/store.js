import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isVercel = Boolean(process.env.VERCEL);

// ─── Redis (Upstash) ───
let redis = null;

async function initRedis() {
  const { Redis } = await import('@upstash/redis');
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    redis = new Redis({ url, token });
  }
}

const REDIS_KEY = 'assinaturas-data';
let redisInitialized = false;

async function getDb() {
  if (!redisInitialized) {
    await initRedis();
    redisInitialized = true;
  }
  return loadRedis();
}

async function loadRedis() {
  if (!redis) return null;
  try {
    const data = await redis.get(REDIS_KEY);
    return data || { people: [] };
  } catch {
    return { people: [] };
  }
}

async function saveRedis(data) {
  if (!redis) return;
  try {
    await redis.set(REDIS_KEY, data);
  } catch {
    // ignore
  }
}

// ─── JSON file (local dev) ───
const DATA_DIR = isVercel ? '/tmp/assinaturas-data' : join(__dirname, '..', 'data');
const DATA_FILE = join(DATA_DIR, 'db.json');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

let fileCache = null;

function loadFile() {
  if (fileCache) return fileCache;
  if (existsSync(DATA_FILE)) {
    try {
      fileCache = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
    } catch {
      fileCache = { people: [] };
    }
  } else {
    fileCache = { people: [] };
  }
  return fileCache;
}

function saveFile(data) {
  try {
    writeFileSync(DATA_FILE, JSON.stringify(data));
  } catch {
    // Vercel readonly sometimes
  }
}

// ─── Unified API ───
function sortPeople(people) {
  return people.sort((a, b) => {
    if (a.paid !== b.paid) return a.paid ? 1 : -1;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}

export async function getPeople(month) {
  if (redis || isVercel) {
    const db = await getDb();
    if (db) {
      return sortPeople(db.people.filter((p) => p.month === month));
    }
  }
  const data = loadFile();
  return sortPeople(data.people.filter((p) => p.month === month));
}

export async function findPerson(month, name) {
  if (redis || isVercel) {
    const db = await getDb();
    if (db) {
      return db.people.find(
        (p) => p.month === month && p.name.toLowerCase() === name.toLowerCase()
      );
    }
  }
  const data = loadFile();
  return data.people.find(
    (p) => p.month === month && p.name.toLowerCase() === name.toLowerCase()
  );
}

export async function getPerson(id) {
  if (redis || isVercel) {
    const db = await getDb();
    if (db) return db.people.find((p) => p.id === id);
  }
  const data = loadFile();
  return data.people.find((p) => p.id === id);
}

export async function addPerson(id, name, month) {
  const person = { id, month, name, paid: false, receipt_data: null, receipt_name: null, paid_at: null, created_at: new Date().toISOString() };

  if (redis || isVercel) {
    const db = await getDb();
    if (db) {
      db.people.push(person);
      await saveRedis(db);
      return;
    }
  }
  const data = loadFile();
  data.people.push(person);
  saveFile(data);
}

export async function togglePaid(id) {
  if (redis || isVercel) {
    const db = await getDb();
    if (db) {
      const person = db.people.find((p) => p.id === id);
      if (!person) return null;
      person.paid = !person.paid;
      person.paid_at = person.paid ? new Date().toISOString().split('T')[0] : null;
      await saveRedis(db);
      return { id, paid: person.paid, paidAt: person.paid_at };
    }
  }
  const data = loadFile();
  const person = data.people.find((p) => p.id === id);
  if (!person) return null;
  person.paid = !person.paid;
  person.paid_at = person.paid ? new Date().toISOString().split('T')[0] : null;
  saveFile(data);
  return { id, paid: person.paid, paidAt: person.paid_at };
}

export async function setReceipt(id, data, name) {
  if (redis || isVercel) {
    const db = await getDb();
    if (db) {
      const person = db.people.find((p) => p.id === id);
      if (!person) return null;
      person.receipt_data = data;
      person.receipt_name = name;
      await saveRedis(db);
      return { id, receipt: { data, name } };
    }
  }
  const db = loadFile();
  const person = db.people.find((p) => p.id === id);
  if (!person) return null;
  person.receipt_data = data;
  person.receipt_name = name;
  saveFile(db);
  return { id, receipt: { data, name } };
}

export async function removeReceipt(id) {
  if (redis || isVercel) {
    const db = await getDb();
    if (db) {
      const person = db.people.find((p) => p.id === id);
      if (!person) return null;
      person.receipt_data = null;
      person.receipt_name = null;
      await saveRedis(db);
      return { id, receipt: null };
    }
  }
  const db = loadFile();
  const person = db.people.find((p) => p.id === id);
  if (!person) return null;
  person.receipt_data = null;
  person.receipt_name = null;
  saveFile(db);
  return { id, receipt: null };
}

export async function deletePerson(id) {
  if (redis || isVercel) {
    const db = await getDb();
    if (db) {
      const idx = db.people.findIndex((p) => p.id === id);
      if (idx === -1) return false;
      db.people.splice(idx, 1);
      await saveRedis(db);
      return true;
    }
  }
  const db = loadFile();
  const idx = db.people.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  db.people.splice(idx, 1);
  saveFile(db);
  return true;
}

export async function exportMonth(month) {
  const people = await getPeople(month);
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
