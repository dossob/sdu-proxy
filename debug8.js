const fetch = require('node-fetch');
const PORTAL = 'https://my.sdu.edu.kz';

async function main() {
  const jar = {};
  function parseCookies(h) { (h.raw()['set-cookie']||[]).forEach(c=>{const[p]=c.split(';');const i=p.indexOf('=');if(i>0)jar[p.substring(0,i).trim()]=p.substring(i+1).trim();}); }
  function cs() { return Object.entries(jar).map(([k,v])=>k+'='+v).join('; '); }
  
  const r1=await fetch(PORTAL+'/', {headers:{'User-Agent':'Mozilla/5.0'}, redirect:'follow'});
  parseCookies(r1.headers);
  
  const r2=await fetch(PORTAL+'/loginAuth.php',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded','Cookie':cs(),'User-Agent':'Mozilla/5.0','Referer':PORTAL+'/','Origin':PORTAL},
    body:new URLSearchParams({username:'240118011',password:'87755114096A1dosx',modstring:'',LogIn:'Log in'}).toString(),
    redirect:'manual'
  });
  parseCookies(r2.headers);
  console.log('jar:', JSON.stringify(jar));
  
  // Follow redirect to index.php first
  const r3=await fetch(PORTAL+'/index.php',{
    headers:{'Cookie':cs(),'User-Agent':'Mozilla/5.0','Referer':PORTAL+'/loginAuth.php'},
    redirect:'manual'
  });
  parseCookies(r3.headers);
  console.log('index status:', r3.status);
  
  // Now fetch transkript
  const r4=await fetch(PORTAL+'/index.php?mod=transkript',{
    headers:{
      'Cookie':cs(),
      'User-Agent':'Mozilla/5.0',
      'Referer':PORTAL+'/index.php',
      'Accept':'text/html,application/xhtml+xml',
    }
  });
  const html=await r4.text();
  console.log('transkript len:', html.length);
  const gpaIdx=html.indexOf('GPA');
  console.log('GPA idx:', gpaIdx);
  if(gpaIdx>0) console.log(html.substring(gpaIdx-50,gpaIdx+200));
}
main().catch(console.error);
