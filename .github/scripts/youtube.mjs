// Roda no GitHub Actions: processa youtube.json
//   tipo "envio": sobe fila/<id>.mp4 com título/descrição/tags e publishAt (ou público, se o horário já passou), depois aplica a capa
//   tipo "capa":  aplica fila/<id>-capa.jpg no vídeo já existente (videoId)
// Itens com erro de limite do YouTube ficam para a próxima rodada. Ao terminar, apaga os arquivos que ninguém mais usa.
import fs from 'node:fs';
import { cleanFila } from './fila.mjs';

const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;
const TESTE = process.env.TESTE === 'true';
if (!YT_REFRESH_TOKEN) throw new Error('Segredos do YouTube não configurados');

const tok = await (await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  body: new URLSearchParams({ client_id: YT_CLIENT_ID, client_secret: YT_CLIENT_SECRET, refresh_token: YT_REFRESH_TOKEN, grant_type: 'refresh_token' }),
})).json();
if (!tok.access_token) throw new Error('Falha ao renovar acesso do YouTube: ' + JSON.stringify(tok));
const H = { Authorization: 'Bearer ' + tok.access_token };

async function yt(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const text = await r.text();
  const j = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
  return { r, j };
}

const me = (await yt('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true')).j.items?.[0];
console.log('Canal:', me?.snippet?.title, me?.snippet?.customUrl);
if (me?.snippet?.customUrl?.toLowerCase() !== '@marshalgtavi') throw new Error('Acesso não é do canal @marshalgtavi');

const fila = JSON.parse(fs.readFileSync('youtube.json', 'utf8'));
const pend = fila.filter(i => i.status === 'pendente' && (!i.depoisDe || new Date(i.depoisDe) <= new Date()));
console.log(`${fila.filter(i => i.status === 'pendente').length} pendentes, ${pend.length} para agora.`);
if (TESTE) { console.log('Modo teste: nada foi enviado.'); process.exit(0); }

async function setThumb(videoId, id) {
  const f = `fila/${id}-capa.jpg`;
  if (!fs.existsSync(f)) return 'sem capa';
  await yt(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}&uploadType=media`,
    { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: fs.readFileSync(f) });
  return 'capa aplicada';
}

for (const item of pend) {
  try {
    if (item.tipo === 'envio') {
      const quando = new Date(item.publicarEm);
      const status = quando > new Date(Date.now() + 5 * 60000)
        ? { privacyStatus: 'private', publishAt: quando.toISOString(), selfDeclaredMadeForKids: false }
        : { privacyStatus: 'public', selfDeclaredMadeForKids: false };
      const meta = { snippet: { title: item.titulo, description: item.descricao, tags: item.tags, categoryId: '20', defaultLanguage: 'pt-BR' }, status };
      const file = `fila/${item.id}.mp4`;
      const size = fs.statSync(file).size;
      const init = await yt('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(size) },
        body: JSON.stringify(meta),
      });
      const up = await yt(init.r.headers.get('location'), { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) }, body: fs.readFileSync(file) });
      item.videoId = up.j.id;
      item.status = 'enviado';
      console.log(item.id, 'enviado:', `https://youtube.com/shorts/${up.j.id}`, status.publishAt ? 'publica ' + status.publishAt : 'público');
      try { console.log(item.id, await setThumb(item.videoId, item.id)); item.capa = 'ok'; }
      catch (e) { console.log(item.id, 'capa fica para depois:', e.message); fila.push({ tipo: 'capa', id: item.id, videoId: item.videoId, status: 'pendente', depoisDe: new Date(Date.now() + 3 * 3600e3).toISOString() }); }
    } else if (item.tipo === 'capa') {
      console.log(item.id, await setThumb(item.videoId, item.id));
      item.status = 'feito';
    }
    item.feitoEm = new Date().toISOString();
  } catch (e) {
    item.ultimoErro = e.message;
    item.tentativas = (item.tentativas || 0) + 1;
    const limite = /exceeded|too many|quota|limit/i.test(e.message);
    if (limite) item.depoisDe = new Date(Date.now() + 2 * 3600e3).toISOString();   // limite do YouTube: tenta em 2h
    else if (item.tentativas >= 5) item.status = 'erro';
    console.log(item.id, 'ERRO:', e.message, limite ? '(limite do YouTube, tento em 2h)' : '');
    if (limite) break;
  }
  fs.writeFileSync('youtube.json', JSON.stringify(fila, null, 2));
}
fs.writeFileSync('youtube.json', JSON.stringify(fila, null, 2));
cleanFila();
