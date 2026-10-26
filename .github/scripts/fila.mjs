// Apaga de fila/ os arquivos que nenhum item pendente (Instagram ou YouTube) ainda precisa.
import fs from 'node:fs';

export function cleanFila() {
  const read = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
  const precisa = new Set([
    ...read('agenda.json').filter(i => i.status === 'agendado').map(i => i.id),
    ...read('youtube.json').filter(i => i.status === 'pendente').map(i => i.id),
    // vídeos que o Buffer (TikTok) ainda pode precisar baixar
    ...read('tiktok.json').filter(i => new Date(i.manterAte) > new Date()).map(i => i.id),
  ]);
  for (const f of fs.readdirSync('fila')) {
    if (f.startsWith('.')) continue;
    const id = f.replace(/(-capa)?\.(mp4|png|jpg)$/, '');
    if (!precisa.has(id)) { fs.rmSync(`fila/${f}`); console.log('apagado da nuvem:', f); }
  }
}
