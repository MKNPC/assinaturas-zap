import express from 'express';
import app from './api/index.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(
  '/data',
  (req, res) => {
    res.status(404).json({ error: 'not found' });
  }
);
app.use(express.static(join(__dirname)));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
