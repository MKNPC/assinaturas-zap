import express from 'express';
import { randomUUID } from 'node:crypto';
import {
  getPeople,
  addPerson,
  findPerson,
  getPerson,
  togglePaid,
  setReceipt,
  removeReceipt,
  deletePerson,
  exportMonth,
} from '../lib/store.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/api/people', (req, res) => {
  const month = req.query.month;
  if (!month) return res.status(400).json({ error: 'month required' });

  const people = getPeople(month).map((p) => ({
    id: p.id,
    name: p.name,
    paid: p.paid,
    receipt: p.receipt_data ? { name: p.receipt_name, data: p.receipt_data } : null,
    paidAt: p.paid_at,
    createdAt: p.created_at,
  }));

  res.json({ month, people });
});

app.post('/api/people', (req, res) => {
  const { name, month } = req.body;
  if (!name || !month) return res.status(400).json({ error: 'name and month required' });

  const trimmed = name.trim();
  if (!trimmed) return res.status(400).json({ error: 'name cannot be empty' });

  if (findPerson(month, trimmed)) {
    return res.status(409).json({ error: 'Esta pessoa já está cadastrada neste mês.' });
  }

  const id = randomUUID();
  addPerson(id, trimmed, month);

  res.status(201).json({ id, name: trimmed, month, paid: false, receipt: null, paidAt: null });
});

const FREE_NAMES = ['mikael lorran natali'];

app.patch('/api/people/:id/toggle', (req, res) => {
  const person = getPerson(req.params.id);
  if (!person) return res.status(404).json({ error: 'not found' });

  if (!person.paid && !person.receipt_data && !FREE_NAMES.includes(person.name.toLowerCase())) {
    return res.status(400).json({ error: 'Adicione uma captura de tela do comprovante' });
  }

  const result = togglePaid(req.params.id);
  res.json(result);
});

app.patch('/api/people/:id/receipt', (req, res) => {
  const { data, name } = req.body;
  if (!data) return res.status(400).json({ error: 'receipt data required' });

  const result = setReceipt(req.params.id, data, name || null);
  if (!result) return res.status(404).json({ error: 'not found' });
  res.json(result);
});

app.delete('/api/people/:id/receipt', (req, res) => {
  const result = removeReceipt(req.params.id);
  if (!result) return res.status(404).json({ error: 'not found' });
  res.json(result);
});

app.delete('/api/people/:id', (req, res) => {
  const ok = deletePerson(req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ deleted: true });
});

app.get('/api/export', (req, res) => {
  const month = req.query.month;
  if (!month) return res.status(400).json({ error: 'month required' });

  res.type('text/plain; charset=utf-8').send(exportMonth(month));
});

export default app;
