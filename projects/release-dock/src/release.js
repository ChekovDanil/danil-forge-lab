import { createHash } from 'node:crypto';

export const releaseTransitions={planned:['building'],building:['healthy','failed'],healthy:['promoted','failed'],promoted:['rolled_back'],failed:['building'],rolled_back:['building']};

export function validateReleaseConfig(config){const errors=[];if(!/^\d+\.\d+\.\d+$/.test(String(config?.version??'')))errors.push('version must be semver');if(!['demo','staging','production'].includes(config?.environment))errors.push('unknown environment');if(!/^\/[a-z0-9/_-]*$/i.test(String(config?.healthPath??'')))errors.push('healthPath must be absolute');if(!Number.isSafeInteger(config?.backupRetention)||config.backupRetention<1||config.backupRetention>90)errors.push('backupRetention must be 1..90');return{valid:errors.length===0,errors};}

export function transitionRelease(release,status,note,now=new Date()){if(!releaseTransitions[release?.status]?.includes(status))throw new Error('Недопустимый переход выпуска');const clean=String(note??'').trim();if(!clean)throw new Error('Комментарий выпуска обязателен');return{...structuredClone(release),status,events:[...(structuredClone(release.events??[])),{status,note:clean,at:now.toISOString()}]};}

export function inspectContainerConfig({dockerfile='',compose=''}){const gates=[
  {id:'non-root',label:'Непривилегированный runtime',pass:/\bUSER\s+node\b/i.test(dockerfile)},
  {id:'healthcheck',label:'Healthcheck контейнера',pass:/\bhealthcheck\s*:/i.test(compose)},
  {id:'local-bind',label:'Порт открыт только локально',pass:/127\.0\.0\.1:\d+:\d+/.test(compose)},
  {id:'read-only',label:'Read-only root filesystem',pass:/read_only\s*:\s*true/i.test(compose)},
  {id:'drop-caps',label:'Linux capabilities отключены',pass:/cap_drop[\s\S]*-\s*ALL/i.test(compose)},
  {id:'no-new-privileges',label:'No new privileges',pass:/no-new-privileges\s*:\s*true/i.test(compose)},
  {id:'state-volume',label:'State вынесен из образа',pass:/\.\/data:\/app\/data/.test(compose)},
  {id:'restart-policy',label:'Явная restart policy',pass:/restart\s*:\s*unless-stopped/i.test(compose)},
];return{gates,passed:gates.filter(item=>item.pass).length,total:gates.length,ready:gates.every(item=>item.pass)};}

export function contentFingerprint(content){const bytes=Buffer.isBuffer(content)?content:Buffer.from(String(content));return{algorithm:'sha256',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}

export function buildBackupManifest({sourceName,content,createdAt=new Date().toISOString()}){if(!String(sourceName??'').trim())throw new Error('sourceName обязателен');return{format:'release-dock-backup/v1',sourceName:String(sourceName),createdAt,...contentFingerprint(content)};}

export function verifyBackup(content,manifest){if(manifest?.format!=='release-dock-backup/v1')return{valid:false,reason:'UNKNOWN_FORMAT'};const actual=contentFingerprint(content);if(actual.bytes!==manifest.bytes)return{valid:false,reason:'SIZE_MISMATCH',actual};if(actual.sha256!==manifest.sha256)return{valid:false,reason:'HASH_MISMATCH',actual};return{valid:true,reason:'MATCH',actual};}

export function redactEnvironment(env){const sensitive=/token|secret|password|key|database_url/i;return Object.fromEntries(Object.entries(env??{}).map(([key,value])=>[key,sensitive.test(key)?'[redacted]':String(value)]));}
