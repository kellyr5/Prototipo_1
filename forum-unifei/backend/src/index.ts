import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.json());

app.use('/api/auth', authRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '🚀 Fórum UNIFEI API funcionando!', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log('\n🚀 Servidor rodando em http://localhost:' + PORT);
  console.log('📋 Health Check: http://localhost:' + PORT + '/api/health\n');
});
