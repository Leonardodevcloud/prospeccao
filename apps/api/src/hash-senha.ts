/**
 * Gera o hash bcrypt para ADMIN_SENHA_HASH sem a senha aparecer no histórico do terminal.
 * Uso: pnpm --filter @prospeccao/api hash-senha
 */
import { createInterface } from 'node:readline/promises';
import bcrypt from 'bcryptjs';

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const senha = await rl.question('Senha do painel (mínimo 12 caracteres): ');
rl.close();

if (senha.length < 12) {
  console.error('Use pelo menos 12 caracteres.');
  process.exit(1);
}
console.log(`\nADMIN_SENHA_HASH=${await bcrypt.hash(senha, 12)}`);
