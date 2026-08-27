import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryJournal, MemorySource, MemoryTarget, SyncBridge } from './src/index.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = join(root, 'public');
const port = Number(process.env.PORT ?? 3090);
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8' };
const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'",
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff'
};
const mapping = {
  fields: {
    name: { from:'profile.name', transform:'trim' },
    email: { from:'profile.email', transforms:['trim','lowercase'] },
    phone: { from:'phone', transform:'digits' },
    segment: { from:'segment', default:'new' }
  },
  required:['name','email']
};

let source;
let target;
let journal;
let bridge;
let lastReport = null;

function resetDemo() {
  source = new MemorySource([
    { id:'lead-101', profile:{ name:'  Анна Смирнова ', email:'ANNA@example.invalid ' }, phone:'+7 (913) 555-10-20', segment:'returning' },
    { id:'lead-102', profile:{ name:'Илья Морозов', email:'ILYA@example.invalid' }, phone:'+7 000 000-00-02' },
    { id:'lead-103', profile:{ name:'Мария Лебедева', email:'TEMP@example.invalid' }, phone:'+7 000 000-00-03', segment:'priority' },
    { id:'lead-104', profile:{ name:'Отклонённая запись', email:'BAD@example.invalid' }, phone:'+7 000 000-00-04' },
    { id:'lead-105', profile:{ name:'Нет почты' }, phone:'+7 000 000-00-05' }
  ], { name:'website-leads' });
  target = new MemoryTarget({
    name:'crm-contacts', keyField:'email',
    initialRecords:[{ name:'Анна', email:'anna@example.invalid', phone:'79130000000', segment:'returning' }],
    failures:{
      'temp@example.invalid':{ times:2, retryable:true, message:'CRM temporarily unavailable' },
      'bad@example.invalid':{ times:999, retryable:false, message:'CRM validation rejected the record' }
    }
  });
  journal = new MemoryJournal();
  bridge = new SyncBridge({ source, target, journal, retryBaseMs:10, sleep:async()=>{} });
  lastReport = null;
}

function mappedRecords() {
  return source.records.map((record) => {
    try { return { sourceId:record.id ?? null, status:'valid', payload:bridge.mapRecord(record,mapping) }; }
    catch (error) { return { sourceId:record.id ?? null, status:'invalid', error:{ code:error.code ?? 'UNEXPECTED_ERROR', message:error.message } }; }
  });
}

function publicState() {
  return {
    source:{ name:source.name, records:structuredClone(source.records) },
    mapping,
    mapped:mappedRecords(),
    target:{ name:target.name, records:target.values(), calls:target.calls.length },
    report:lastReport,
    journal:journal.list().slice().reverse(),
    boundary:'Local in-memory demo · no real APIs · at-least-once, not exactly-once'
  };
}

async function runAction(action) {
  if (action === 'reset') { resetDemo(); return { title:'Демо сброшено', detail:'Источник, CRM и журнал вернулись в исходное состояние.', tone:'neutral' }; }
  if (action === 'change-source') {
    const record = source.records.find((item) => item.id === 'lead-101');
    record.profile.name = record.profile.name.includes('Петрова') ? '  Анна Смирнова ' : 'Анна Смирнова-Петрова';
    record.phone = record.phone.includes('99-99') ? '+7 (913) 555-10-20' : '+7 (913) 555-99-99';
    lastReport = null;
    return { title:'Источник изменён', detail:'Mapped payload изменился — следующий запуск станет update, а не duplicate.', tone:'changed' };
  }
  if (action === 'dry-run') {
    lastReport = await bridge.run({ mapping, dryRun:true });
    return { title:'Предпросмотр готов', detail:'Целевая CRM не получила ни одного вызова.', tone:'preview' };
  }
  if (action === 'apply' || action === 'replay') {
    lastReport = await bridge.run({ mapping });
    const detail = `${lastReport.succeeded} успешно · ${lastReport.skipped} пропущено · ${lastReport.failed} с ошибкой`;
    return { title:action === 'replay' ? 'Повторный запуск завершён' : 'Синхронизация завершена', detail, tone:lastReport.failed ? 'partial' : 'success' };
  }
  throw new Error('UNKNOWN_ACTION');
}

async function readJson(request) {
  let body='';
  for await (const chunk of request) { body += chunk; if (body.length > 10_000) throw new Error('PAYLOAD_TOO_LARGE'); }
  return body ? JSON.parse(body) : {};
}

resetDemo();

createServer(async(request,response)=>{
  const url=new URL(request.url??'/','http://localhost');
  if(url.pathname==='/api/state'&&request.method==='GET'){
    response.writeHead(200,{...securityHeaders,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(publicState()));return;
  }
  if(url.pathname==='/api/action'&&request.method==='POST'){
    try{const {action}=await readJson(request),result=await runAction(action);response.writeHead(200,{...securityHeaders,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify({result,state:publicState()}));}
    catch(error){response.writeHead(400,{...securityHeaders,'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify({error:error.code??error.message??'ACTION_FAILED'}));}return;
  }
  if(url.pathname.startsWith('/api/')){response.writeHead(404,securityHeaders);response.end('Not found');return;}
  if(!['GET','HEAD'].includes(request.method??'GET')){response.writeHead(405,{...securityHeaders,Allow:'GET, HEAD'});response.end();return;}
  const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^[/\\]+/,'');const file=normalize(join(publicRoot,relative));
  if(!file.startsWith(publicRoot)||!existsSync(file)||!statSync(file).isFile()){response.writeHead(404,securityHeaders);response.end('Not found');return;}
  response.writeHead(200,{...securityHeaders,'Content-Type':types[extname(file)]??'application/octet-stream'});if(request.method==='HEAD')response.end();else createReadStream(file).pipe(response);
}).listen(port,'127.0.0.1',()=>console.log(`SyncBridge Rehearsal: http://127.0.0.1:${port}`));
