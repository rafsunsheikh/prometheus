import { SignJWT } from 'jose';
import { readFileSync, writeFileSync } from 'node:fs';
const API='https://prometheus-api.rafsunsheikh116-6a6.workers.dev';
const S=process.argv[2];
const secret=readFileSync(`${S}/session-secret.txt`,'utf8').trim();
const tok=await new SignJWT({name:'Rafsun Sheikh',via:null}).setProtectedHeader({alg:'HS256'})
  .setSubject('rafsun.sheikh@audd.digital').setIssuer('prometheus').setAudience('prometheus-web')
  .setIssuedAt().setExpirationTime('2h').sign(new TextEncoder().encode(secret));
const H={Authorization:`Bearer ${tok}`};

const list=await (await fetch(`${API}/api/books`,{headers:H})).json();
const b=list.books[0];
console.log('library:', list.books.length, 'book(s)');
console.log(' ', b.title, '|', b.author, '| hasSummary:', b.hasSummary, '| job:', b.job.status, b.job.stage, `${b.job.done}/${b.job.total}`);

const sum=await (await fetch(`${API}/api/books/${b.id}/summary`,{headers:H})).json();
console.log('\nsummary read from R2:', sum.markdown.length, 'chars | model:', sum.model, '| words:', sum.wordCount);
writeFileSync(`${S}/live-summary.md`, sum.markdown);

const content=await (await fetch(`${API}/api/books/${b.id}/content`,{headers:H})).json();
console.log('book text read from R2:', content.markdown.length, 'chars');
console.log('\nheadings:');
for (const h of sum.markdown.match(/^#{1,2} .+$/gm).slice(0,8)) console.log('  '+h);
