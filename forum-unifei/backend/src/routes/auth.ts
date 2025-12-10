import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

const router = Router();

const usuarios = [
  { id: 1, matricula: '2022.1.001', email: 'd20221001@unifei.edu.br', nome: 'Maria Silva', curso: 'CCO', tipo: 'aluno', reputacao: 150 },
  { id: 2, matricula: '2021.2.042', email: 'd20212042@unifei.edu.br', nome: 'João Santos', curso: 'SIN', tipo: 'monitor', reputacao: 450 },
  { id: 3, matricula: '2020.1.015', email: 'd20201015@unifei.edu.br', nome: 'Ana Costa', curso: 'ECO', tipo: 'aluno', reputacao: 280 },
];

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { matricula, senha } = req.body;
    if (!matricula || !senha) return res.status(400).json({ success: false, message: 'Matrícula e senha são obrigatórios' });
    
    const usuario = usuarios.find(u => u.matricula === matricula);
    if (!usuario) return res.status(401).json({ success: false, message: 'Matrícula ou senha inválidos' });
    
    if (senha.length < 4) return res.status(401).json({ success: false, message: 'Senha deve ter no mínimo 4 caracteres' });

    const token = jwt.sign({ id: usuario.id, matricula: usuario.matricula, tipo: usuario.tipo }, 
      process.env.JWT_SECRET || 'forum-unifei-secret-2024', { expiresIn: '7d' });

    res.json({ success: true, message: 'Login realizado com sucesso!', data: { usuario, token } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

router.get('/me', (req: Request, res: Response) => {
  res.json({ success: true, data: usuarios[0] });
});

export default router;
