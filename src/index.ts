import { app } from './app.js';

// Porta dinâmica (Render injeta PORT automaticamente)
const port = Number(process.env.PORT) || 3000;

// Healthcheck básico
app.get('/', (_req, res) => {
  res.status(200).send('WChic backend OK');
});

// Sobe o servidor
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
