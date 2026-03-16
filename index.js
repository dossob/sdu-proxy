const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const PORTAL = 'https://my.sdu.edu.kz';

app.get('/', (req, res) => res.json({ status: 'ok', service: 'sdu-proxy' }));

app.post('/portal/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'credentials required' });
    const cleanUser = username.includes('@') ? username.split('@')[0] : username;

    // Step 1: GET index.php to obtain PHPSESSID
    const initRes = await fetch(`${PORTAL}/index.php`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      redirect: 'follow',
    });
    const initCookies = (initRes.headers.raw()['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

    // Step 2: POST loginAuth.php with PHPSESSID
    const loginRes = await fetch(`${PORTAL}/loginAuth.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': `${PORTAL}/index.php`,
        'Origin': PORTAL,
        'Cookie': initCookies,
      },
      body: new URLSearchParams({
        username: cleanUser,
        password,
        modstring: '',
        LogIn: 'Log in',
      }).toString(),
      redirect: 'manual',
    });

    // Step 3: Collect all cookies
    const allCookies = [...initCookies.split('; ')];
    const loginCookies = (loginRes.headers.raw()['set-cookie'] || []).map(c => c.split(';')[0]);
    loginCookies.forEach(c => { if (c && !allCookies.includes(c)) allCookies.push(c); });
    const cookieHeader = allCookies.filter(Boolean).join('; ');

    if (!cookieHeader.includes('uname')) {
      return res.status(401).json({ error: 'Login failed. Wrong credentials.', cookies: cookieHeader });
    }

    // Step 4: Fetch home page
    const homeRes = await fetch(`${PORTAL}/index.php`, {
      headers: { 'Cookie': cookieHeader, 'User-Agent': 'Mozilla/5.0' },
    });
    const html = await homeRes.text();

    if (req.query.debug) return res.json({ html: html.substring(0, 4000), cookies: cookieHeader });

    const student = parseProfile(html);
    const currHtml = await fetchPage(`${PORTAL}/index.php?mod=course_struct`, cookieHeader);
    const curriculum = parseCurriculum(currHtml);
    const gradeHtml = await fetchPage(`${PORTAL}/index.php?mod=transcript`, cookieHeader);
    const grades = parseGrades(gradeHtml);

    res.json({ success: true, student, curriculum, grades });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

async function fetchPage(url, cookie) {
  try {
    const res = await fetch(url, { headers: { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0' } });
    return await res.text();
  } catch { return ''; }
}

function parseProfile(html) {
  function getField(...labels) {
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped + '[^<]*<\\/td>\\s*<td[^>]*>\\s*([^<]{1,200})', 'i');
      const m = html.match(re);
      if (m && m[1].trim()) return m[1].trim();
    }
    return null;
  }
  const name = getField('Fullname', 'Name Surname', 'Full name');
  const program = getField('Program / Class', 'Major Program', 'Program');
  const email = getField('Email', 'E-mail');
  const studentId = getField('Student №', 'Student No', 'Student ID', 'Student');
  let major = null, year = null;
  if (program) {
    const yearMatch = program.match(/-\s*(\d+)\s*$/);
    if (yearMatch) {
      const n = parseInt(yearMatch[1]);
      year = `${n}${['st','nd','rd'][n-1]||'th'} Year`;
      major = program.replace(/-\s*\d+\s*$/, '').trim();
    } else { major = program; }
  }
  const photoMatch = html.match(/stud_photo\.php\?[^"'\s>]+/);
  const photo = photoMatch ? `${PORTAL}/${photoMatch[0]}` : null;
  const gpaMatch = html.match(/GPA[^<\d]*([\d]+\.[\d]+)/i);
  const gpa = gpaMatch ? gpaMatch[1] : null;
  return { name, major, year, email, studentId, photo, gpa };
}

function parseCurriculum(html) {
  if (!html) return [];
  const courses = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let c;
    while ((c = cellRe.exec(m[1])) !== null) cells.push(c[1].replace(/<[^>]+>/g, '').trim());
    if (cells.length >= 3 && cells[1] && /^[A-Z]{2,4}\s*\d+/.test(cells[1])) {
      courses.push({ code: cells[1], name: cells[2]||'', credits: cells[4]||'', grade: cells[6]||'', status: cells[8]||'' });
    }
  }
  return courses;
}

function parseGrades(html) {
  if (!html) return [];
  const grades = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let c;
    while ((c = cellRe.exec(m[1])) !== null) cells.push(c[1].replace(/<[^>]+>/g, '').trim());
    if (cells.length >= 3 && /^\d+$/.test(cells[0])) {
      grades.push({ semester: cells[1]||'', code: cells[2]||'', name: cells[3]||'', credits: cells[4]||'', grade: cells[5]||'', gpa: cells[6]||'' });
    }
  }
  return grades;
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`SDU Proxy running on port ${PORT}`));
