// Roda no GitHub Actions: publica no Instagram os itens de agenda.json cujo horário já chegou.
// O vídeo e a capa ficam em fila/ e são servidos pelo GitHub Pages (link público que o Instagram baixa).
// Depois de publicar, apaga os arquivos da fila e marca o item como publicado.
import fs from 'node:fs';

const SITE = 'https://garagemarcal.github.io/marshalgtavi';
const API = 'https://graph.instagram.com/v23.0';
const TOKEN = process.env.IG_TOKEN;
const TESTE = process.env.TESTE === 'true';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(method, url, params = {}) {
  const body = new URLSearchParams({ ...params, access_token: TOKEN });
  const res = method === 'GET' ? await fetch(`${API}${url}?${body}`) : await fetch(API + url, { method, body });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j;
}

const agenda = JSON.parse(fs.readFileSync('agenda.json', 'utf8'));
const agora = Date.now();
const devidos = agenda.filter(i => i.status === 'agendado' && new Date(i.quando).getTime() <= agora);
console.log(`${agenda.filter(i => i.status === 'agendado').length} na fila, ${devidos.length} no horário.`);
if (!TOKEN) throw new Error('Segredo IG_TOKEN não configurado');

const me = await call('GET', '/me', { fields: 'user_id,username' });
console.log(`Conta: @${me.username}`);
if (me.username !== 'marshalgtavi') throw new Error('Token não é do @marshalgtavi');
if (TESTE) { console.log('Modo teste: nada foi publicado.'); process.exit(0); }

for (const item of devidos) {
  try {
    const video = `${SITE}/fila/${item.id}.mp4`;
    const capa = `${SITE}/fila/${item.id}-capa.png`;
    if (!(await fetch(video, { method: 'HEAD' })).ok) { console.log(item.id, 'vídeo ainda não está no ar, tento na próxima rodada'); continue; }
    const temCapa = (await fetch(capa, { method: 'HEAD' })).ok;
    const c = await call('POST', `/${me.user_id}/media`, {
      media_type: 'REELS', video_url: video, caption: item.legenda, share_to_feed: 'true', ...(temCapa ? { cover_url: capa } : {}),
    });
    let ok = false;
    for (let i = 0; i < 90; i++) {
      const s = await call('GET', `/${c.id}`, { fields: 'status_code,status' });
      if (s.status_code === 'FINISHED') { ok = true; break; }
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error('processamento falhou: ' + s.status);
      await sleep(5000);
    }
    if (!ok) throw new Error('Instagram demorou demais para processar');
    const p = await call('POST', `/${me.user_id}/media_publish`, { creation_id: c.id });
    const m = await call('GET', `/${p.id}`, { fields: 'permalink' });
    Object.assign(item, { status: 'publicado', link: m.permalink, publicadoEm: new Date().toISOString() });
    for (const f of [`fila/${item.id}.mp4`, `fila/${item.id}-capa.png`]) fs.rmSync(f, { force: true });
    console.log(item.id, 'publicado:', m.permalink);
  } catch (e) {
    item.tentativas = (item.tentativas || 0) + 1;
    item.ultimoErro = e.message;
    if (item.tentativas >= 5) item.status = 'erro';
    console.log(item.id, 'ERRO:', e.message);
  }
  fs.writeFileSync('agenda.json', JSON.stringify(agenda, null, 2));
}
