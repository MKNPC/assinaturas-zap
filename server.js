import express from 'express';
import initSqlJs from 'sql.js';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const DB_PATH = join(DATA_DIR, 'db.sqlite');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
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

function queryAll(db, sql, params = {}) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(db, sql, params = {}) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

async function init() {
  const SQL = await initSqlJs();

  let db;

  function loadDatabase() {
    if (existsSync(DB_PATH)) {
      const buffer = readFileSync(DB_PATH);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }
  }

  function saveDatabase() {
    const data = db.export();
    writeFileSync(DB_PATH, Buffer.from(data));
  }

  loadDatabase();

  db.run(`
    CREATE TABLE IF NOT EXISTS people (
      id        TEXT PRIMARY KEY,
      month     TEXT NOT NULL,
      name      TEXT NOT NULL,
      paid      INTEGER NOT NULL DEFAULT 0,
      receipt_data  TEXT,
      receipt_name  TEXT,
      paid_at   TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_people_month ON people(month)`);
  saveDatabase();

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(join(__dirname)));

  // ─── GET /api/people?month=YYYY-MM ───
  app.get('/api/people', (req, res) => {
    const month = req.query.month;
    if (!month) return res.status(400).json({ error: 'month required' });

    const rows = queryAll(db, 'SELECT * FROM people WHERE month = $month ORDER BY paid ASC, name ASC', { $month: month });
    const people = rows.map((r) => ({
      id: r.id,
      name: r.name,
      paid: Boolean(r.paid),
      receipt: r.receipt_data ? { name: r.receipt_name, data: r.receipt_data } : null,
      paidAt: r.paid_at,
      createdAt: r.created_at,
    }));

    res.json({ month, people });
  });

  // ─── POST /api/people ───
  app.post('/api/people', (req, res) => {
    const { name, month } = req.body;
    if (!name || !month) return res.status(400).json({ error: 'name and month required' });

    const trimmed = name.trim();
    if (!trimmed) return res.status(400).json({ error: 'name cannot be empty' });

    const existing = queryOne(db, 'SELECT id FROM people WHERE month = $month AND name = $name', {
      $month: month,
      $name: trimmed,
    });
    if (existing) return res.status(409).json({ error: 'Esta pessoa já está cadastrada neste mês.' });

    const id = randomUUID();
    db.run('INSERT INTO people (id, month, name) VALUES ($id, $month, $name)', {
      $id: id,
      $month: month,
      $name: trimmed,
    });
    saveDatabase();

    res.status(201).json({ id, name: trimmed, month, paid: false, receipt: null, paidAt: null });
  });

  // ─── PATCH /api/people/:id/toggle ───
  app.patch('/api/people/:id/toggle', (req, res) => {
    const person = queryOne(db, 'SELECT * FROM people WHERE id = $id', { $id: req.params.id });
    if (!person) return res.status(404).json({ error: 'not found' });

    const newPaid = person.paid ? 0 : 1;
    const paidAt = newPaid ? todayISO() : null;

    db.run('UPDATE people SET paid = $paid, paid_at = $paid_at WHERE id = $id', {
      $paid: newPaid,
      $paid_at: paidAt,
      $id: req.params.id,
    });
    saveDatabase();

    res.json({ id: person.id, paid: Boolean(newPaid), paidAt });
  });

  // ─── PATCH /api/people/:id/receipt ───
  app.patch('/api/people/:id/receipt', (req, res) => {
    const { data, name } = req.body;
    if (!data) return res.status(400).json({ error: 'receipt data required' });

    const person = queryOne(db, 'SELECT id FROM people WHERE id = $id', { $id: req.params.id });
    if (!person) return res.status(404).json({ error: 'not found' });

    db.run('UPDATE people SET receipt_data = $data, receipt_name = $name WHERE id = $id', {
      $data: data,
      $name: name || null,
      $id: req.params.id,
    });
    saveDatabase();

    res.json({ id: req.params.id, receipt: { data, name: name || null } });
  });

  // ─── DELETE /api/people/:id/receipt ───
  app.delete('/api/people/:id/receipt', (req, res) => {
    const person = queryOne(db, 'SELECT id FROM people WHERE id = $id', { $id: req.params.id });
    if (!person) return res.status(404).json({ error: 'not found' });

    db.run('UPDATE people SET receipt_data = NULL, receipt_name = NULL WHERE id = $id', { $id: req.params.id });
    saveDatabase();

    res.json({ id: req.params.id, receipt: null });
  });

  // ─── DELETE /api/people/:id ───
  app.delete('/api/people/:id', (req, res) => {
    const person = queryOne(db, 'SELECT id FROM people WHERE id = $id', { $id: req.params.id });
    if (!person) return res.status(404).json({ error: 'not found' });

    db.run('DELETE FROM people WHERE id = $id', { $id: req.params.id });
    saveDatabase();

    res.json({ deleted: true });
  });

  // ─── GET /api/export?month=YYYY-MM ───
  app.get('/api/export', (req, res) => {
    const month = req.query.month;
    if (!month) return res.status(400).json({ error: 'month required' });

    const rows = queryAll(db, 'SELECT * FROM people WHERE month = $month ORDER BY paid ASC, name ASC', { $month: month });
    const paid = rows.filter((r) => r.paid).length;

    const lines = [
      `=== Assinaturas Zap - ${getMonthLabel(month)} ===`,
      `Total: ${rows.length} | Pagos: ${paid}`,
      '',
      'Nome | Status | Data',
      '-'.repeat(40),
    ];

    for (const r of rows) {
      const status = r.paid ? '✅ Pago' : '⬜ Pendente';
      const date = r.paid_at ? formatDate(r.paid_at) : '-';
      lines.push(`${r.name} | ${status} | ${date}`);
    }

    res.type('text/plain; charset=utf-8').send(lines.join('\r\n'));
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}

init().catch((err) => {
  console.error('Falha ao iniciar:', err);
  process.exit(1);
});
