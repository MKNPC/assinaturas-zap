import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isVercel = Boolean(process.env.VERCEL);

const GH_TOKEN = process.env.GH_TOKEN || process.env.gh_token;
const GH_REPO = process.env.VERCEL_GIT_REPO_OWNER
  ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_REPO}`
  : 'MKNPC/assinaturas-zap';
const GH_PATH = 'data/db.json';
const GH_BRANCH = 'master';

// ─── GitHub API (Vercel) ───
async function ghFetch(method, body = null) {
  if (!GH_TOKEN) return null;
  const url = `https://api.github.com/repos/${GH_REPO}/contents/${GH_PATH}`;
  const opts = {
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'assinaturas-zap',
    },
  };

  if (method === 'GET') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    opts.signal = controller.signal;
    try {
      const res = await fetch(url, opts);
      if (res.status === 404) return null;
      if (!res.ok) return null;
      const data = await res.json();
      const content = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
      content._sha = data.sha;
      return content;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  if (method === 'PUT') {
    const { content, sha } = body;
    const putBody = {
      message: 'atualiza dados',
      branch: GH_BRANCH,
      content: Buffer.from(JSON.stringify(content)).toString('base64'),
    };
    if (sha) putBody.sha = sha;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(url, {
        ...opts,
        method: 'PUT',
        body: JSON.stringify(putBody),
        signal: controller.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}

async function loadGH() {
  const data = await ghFetch('GET');
  if (!data) return { data: { people: [] }, sha: null };
  const sha = data._sha;
  delete data._sha;
  return { data, sha };
}

async function saveGH(db, sha) {
  return ghFetch('PUT', { content: db, sha });
}

// ─── JSON file (local dev) ───
const DATA_DIR = isVercel ? '/tmp/assinaturas-data' : join(__dirname, '..', 'data');
const DATA_FILE = join(DATA_DIR, 'db.json');

if (!existsSync(DATA_DIR)) {
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}
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

function saveFile(data, fallbackToMemory = false) {
  try {
    writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch {
    // read-only filesystem (Vercel without GitHub token)
  }
}

// ─── Unified API ───
function sortPeople(people) {
  return people.sort((a, b) => {
    if (a.paid !== b.paid) return a.paid ? 1 : -1;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}

function filterMonth(people, month) {
  return sortPeople(people.filter((p) => p.month === month));
}

let ghCache = null;

async function getDB() {
  if (isVercel && GH_TOKEN) {
    try {
      const result = await loadGH();
      if (result) {
        ghCache = result;
        return result.data;
      }
    } catch {
      // GitHub API failed, fall through
    }
  }

  try {
    return loadFile();
  } catch {
    return { people: [] };
  }
}

async function writeDB(data) {
  let saved = false;

  if (isVercel && GH_TOKEN) {
    try {
      const sha = ghCache?.sha;
      await saveGH(data, sha);
      ghCache = { data, sha: null };
      saved = true;
    } catch {
      // GitHub API failed
    }
  }

  if (!saved) {
    try { saveFile(data); } catch {}
  }
}

export async function getPeople(month) {
  const db = await getDB();
  return filterMonth(db.people, month);
}

export async function findPerson(month, name) {
  const db = await getDB();
  return db.people.find(
    (p) => p.month === month && p.name.toLowerCase() === name.toLowerCase()
  );
}

export async function getPerson(id) {
  const db = await getDB();
  return db.people.find((p) => p.id === id);
}

export async function addPerson(id, name, month) {
  const db = await getDB();
  db.people.push({
    id, month, name,
    paid: false,
    receipt_data: null,
    receipt_name: null,
    paid_at: null,
    created_at: new Date().toISOString(),
  });
  await writeDB(db);
}

export async function togglePaid(id) {
  const db = await getDB();
  const person = db.people.find((p) => p.id === id);
  if (!person) return null;
  person.paid = !person.paid;
  person.paid_at = person.paid ? new Date().toISOString().split('T')[0] : null;
  await writeDB(db);
  return { id, paid: person.paid, paidAt: person.paid_at };
}

export async function setReceipt(id, data, name) {
  const db = await getDB();
  const person = db.people.find((p) => p.id === id);
  if (!person) return null;
  person.receipt_data = data;
  person.receipt_name = name;
  await writeDB(db);
  return { id, receipt: { data, name } };
}

export async function removeReceipt(id) {
  const db = await getDB();
  const person = db.people.find((p) => p.id === id);
  if (!person) return null;
  person.receipt_data = null;
  person.receipt_name = null;
  await writeDB(db);
  return { id, receipt: null };
}

export async function deletePerson(id) {
  const db = await getDB();
  const idx = db.people.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  db.people.splice(idx, 1);
  await writeDB(db);
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
