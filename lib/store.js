import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isVercel = Boolean(process.env.VERCEL);

const GH_TOKEN = process.env.GH_TOKEN || process.env.gh_token;
const GH_REPO = 'MKNPC/assinaturas-zap';
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
    const timer = setTimeout(() => controller.abort(), 5000);
    opts.signal = controller.signal;
    try {
      const res = await fetch(url, opts);
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return await res.json();
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
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, {
        ...opts,
        method: 'PUT',
        body: JSON.stringify(putBody),
        signal: controller.signal,
      });
      if (!res.ok) return res.status === 422 ? 'conflict' : false;
      const out = await res.json();
      return out?.content?.sha || null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}

async function ghFetchBlob(sha) {
  if (!GH_TOKEN || !sha) return null;
  const url = `https://api.github.com/repos/${GH_REPO}/git/blobs/${sha}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'assinaturas-zap',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadGHRaw() {
  const url = `https://raw.githubusercontent.com/${GH_REPO}/${GH_BRANCH}/${GH_PATH}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function loadGH() {
  const meta = await ghFetch('GET');
  if (!meta) return null;
  const sha = meta.sha || null;

  let base64 = meta.content;
  if (base64) {
    try {
      const db = JSON.parse(Buffer.from(base64, 'base64').toString('utf-8'));
      return { data: db, sha };
    } catch {
      base64 = null;
    }
  }

  const rawText = await loadGHRaw();
  if (rawText) {
    try {
      return { data: JSON.parse(rawText), sha };
    } catch {
      // fall through to blob API
    }
  }

  const blobBase64 = await ghFetchBlob(sha);
  if (!blobBase64) return null;
  try {
    const db = JSON.parse(Buffer.from(blobBase64, 'base64').toString('utf-8'));
    return { data: db, sha };
  } catch {
    return null;
  }
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
let ghCacheAt = 0;

async function getDB() {
  if (isVercel && GH_TOKEN) {
    if (ghCache && Date.now() - ghCacheAt < 6000) return ghCache.data;
    try {
      const result = await loadGH();
      if (result) {
        ghCache = result;
        ghCacheAt = Date.now();
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

async function saveToGithub(data) {
  let attemptsLeft = 2;
  while (attemptsLeft > 0) {
    attemptsLeft--;
    let sha = ghCache?.sha || null;
    if (!sha) {
      try {
        const latest = await loadGH();
        if (latest) sha = latest.sha;
      } catch {
        // fetch failed, sha stays null
      }
    }
    if (!sha) return false;

    const outcome = await saveGH(data, sha);
    if (typeof outcome === 'string') {
      ghCache = { data, sha: outcome };
      ghCacheAt = Date.now();
      return true;
    }
    ghCache = null;
    ghCacheAt = 0;
    if (outcome === 'conflict') continue;
    if (outcome === false) return false;
    await sleep(200);
  }
  return false;
}

async function writeDB(data) {
  let githubOk = false;

  if (isVercel && GH_TOKEN) {
    githubOk = await saveToGithub(data);
  }

  if (!githubOk) {
    try {
      saveFile(data);
    } catch {
      // filesystem unavailable (read-only deploy)
    }
    if (isVercel && GH_TOKEN) {
      throw new Error('Não foi possível salvar os dados no servidor. Tente novamente.');
    }
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

let mutationQueue = Promise.resolve();
function queued(fn) {
  const run = mutationQueue.then(fn);
  mutationQueue = run.catch(() => {});
  return run;
}

export async function addPerson(id, name, month) {
  await queued(async () => {
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
  });
}

export async function togglePaid(id) {
  let result = null;
  await queued(async () => {
    const db = await getDB();
    const person = db.people.find((p) => p.id === id);
    if (!person) return;
    person.paid = !person.paid;
    person.paid_at = person.paid ? new Date().toISOString().split('T')[0] : null;
    await writeDB(db);
    result = { id, paid: person.paid, paidAt: person.paid_at };
  });
  return result;
}

export async function setReceipt(id, data, name) {
  let result = null;
  await queued(async () => {
    const db = await getDB();
    const person = db.people.find((p) => p.id === id);
    if (!person) return;
    person.receipt_data = data;
    person.receipt_name = name;
    await writeDB(db);
    result = { id, receipt: { data, name } };
  });
  return result;
}

export async function removeReceipt(id) {
  let result = null;
  await queued(async () => {
    const db = await getDB();
    const person = db.people.find((p) => p.id === id);
    if (!person) return;
    person.receipt_data = null;
    person.receipt_name = null;
    await writeDB(db);
    result = { id, receipt: null };
  });
  return result;
}

export async function deletePerson(id) {
  let existed = false;
  await queued(async () => {
    const db = await getDB();
    const idx = db.people.findIndex((p) => p.id === id);
    if (idx === -1) return;
    db.people.splice(idx, 1);
    await writeDB(db);
    existed = true;
  });
  return existed;
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
