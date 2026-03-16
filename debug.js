const fetch = require('node-fetch');
const PORTAL = 'https://my.sdu.edu.kz';

async function main() {
  const jar = {};
  function parseCookies(headers) {
    const raw = headers.raw()['set-cookie'] || [];
    raw.forEach(c => {
      const [pair] = c.split(';');
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) jar[pair.substring(0, eqIdx).trim()] = pair.substring(eqIdx + 1).trim();
    });
  }
  function cookieStr() {
    return Object.entries(jar).map(([k,v]) => k+'='+v).join('; ');
  }

  const r1 = await fetch(PORTAL + '/', { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' });
  parseCookies(r1.headers);

  const r2 = await fetch(PORTAL + '/loginAuth.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0', 'Referer': PORTAL + '/index.php', 'Origin': PORTAL, 'Cookie': cookieStr() },
    body: new URLSearchParams({ username: '240118011', password: '87755114096A1dosx', modstring: '', LogIn: 'Log in' }).toString(),
    redirect: 'manual',
  });
  parseCookies(r2.headers);
  console.log('JAR:', jar);

  const homeRes = await fetch(PORTAL + '/index.php', { headers: { 'Cookie': cookieStr(), 'User-Agent': 'Mozilla/5.0' } });
  const html = await homeRes.text();
  
  // Find student info table
  const idx = html.indexOf('240118011');
  console.log('studentId idx:', idx);
  if (idx > 0) console.log(html.substring(idx-500, idx+500));
  else {
    // Print middle section
    console.log('HTML length:', html.length);
    console.log(html.substring(3000, 6000));
  }
}
main().catch(console.error);
