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

const FREE_NAMES = ['mikael lorran natali'];

app.get('/api/people', async (req, res) => {
  const month = req.query.month;
  if (!month) return res.status(400).json({ error: 'month required' });

  const people = (await getPeople(month)).map((p) => ({
    id: p.id,
    name: p.name,
    paid: p.paid,
    receipt: p.receipt_data ? { name: p.receipt_name, data: p.receipt_data } : null,
    paidAt: p.paid_at,
    createdAt: p.created_at,
  }));

  res.json({ month, people });
});

app.post('/api/people', async (req, res) => {
  const { name, month } = req.body;
  if (!name || !month) return res.status(400).json({ error: 'name and month required' });

  const trimmed = name.trim();
  if (!trimmed) return res.status(400).json({ error: 'name cannot be empty' });

  if (await findPerson(month, trimmed)) {
    return res.status(409).json({ error: 'Esta pessoa já está cadastrada neste mês.' });
  }

  const id = randomUUID();
  await addPerson(id, trimmed, month);

  res.status(201).json({ id, name: trimmed, month, paid: false, receipt: null, paidAt: null });
});

app.patch('/api/people/:id/toggle', async (req, res) => {
  const person = await getPerson(req.params.id);
  if (!person) return res.status(404).json({ error: 'not found' });

  if (!person.paid && !person.receipt_data && !FREE_NAMES.includes(person.name.toLowerCase())) {
    return res.status(400).json({ error: 'Anexe o print do seu comprovante' });
  }

  const result = await togglePaid(req.params.id);
  res.json(result);
});

app.patch('/api/people/:id/receipt', async (req, res) => {
  const { data, name } = req.body;
  if (!data) return res.status(400).json({ error: 'receipt data required' });

  const result = await setReceipt(req.params.id, data, name || null);
  if (!result) return res.status(404).json({ error: 'not found' });
  res.json(result);
});

app.delete('/api/people/:id/receipt', async (req, res) => {
  const result = await removeReceipt(req.params.id);
  if (!result) return res.status(404).json({ error: 'not found' });
  res.json(result);
});

app.delete('/api/people/:id', async (req, res) => {
  const ok = await deletePerson(req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ deleted: true });
});

app.get('/api/export', async (req, res) => {
  const month = req.query.month;
  if (!month) return res.status(400).json({ error: 'month required' });

  res.type('text/plain; charset=utf-8').send(await exportMonth(month));
});

export default app;
