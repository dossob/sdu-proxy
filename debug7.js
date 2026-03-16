const fetch = require('node-fetch');
const PORTAL = 'https://my.sdu.edu.kz';

async function main() {
  const jar = {};
  function parseCookies(h) { (h.raw()['set-cookie']||[]).forEach(c=>{const[p]=c.split(';');const i=p.indexOf('=');if(i>0)jar[p.substring(0,i).trim()]=p.substring(i+1).trim();}); }
  function cs() { return Object.entries(jar).map(([k,v])=>k+'='+v).join('; '); }
  const r1=await fetch(PORTAL+'/');parseCookies(r1.headers);
  const r2=await fetch(PORTAL+'/loginAuth.php',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Cookie':cs(),'User-Agent':'Mozilla/5.0'},body:new URLSearchParams({username:'240118011',password:'87755114096A1dosx',modstring:'',LogIn:'Log in'}).toString(),redirect:'manual'});
  parseCookies(r2.headers);
  
  const r=await fetch(PORTAL+'/index.php?mod=transkript',{headers:{'Cookie':cs(),'User-Agent':'Mozilla/5.0'}});
  const html=await r.text();
  console.log('len:', html.length);
  const idx=html.indexOf('B-');
  console.log('B- idx:', idx);
  if(idx>0) console.log(html.substring(idx-400, idx+400));
  else console.log(html.substring(6000, 9000));
}
main().catch(console.error);
