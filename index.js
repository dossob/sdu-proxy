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
      body: new URLSearchParams({ username: cleanUser, password, modstring: '', LogIn: 'Log in' }).toString(),
      redirect: 'manual',
    });
    parseCookies(r2.headers);

    if (!jar['uname']) return res.status(401).json({ error: 'Login failed. Wrong credentials.' });

    const profileHtml = await fetchPage(PORTAL + '/index.php?mod=profile', cookieStr());
    const transcriptHtml = await fetchPage(PORTAL + '/index.php?mod=transcript', cookieStr());
    const student = parseProfile(profileHtml, transcriptHtml);
    const currHtml = await fetchPage(PORTAL + '/index.php?mod=course_struct', cookieStr());
    const curriculum = parseCurriculum(currHtml);
    const grades = parseGrades(transcriptHtml);

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

function parseProfile(html, transcriptHtml) {
  function getField(label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped + '\\s*:\\s*<\\/td>\\s*<td[^>]*>\\s*([^<]{1,200})', 'i');
    const m = html.match(re);
    return m ? m[1].trim() : null;
  }

  const name = getField('Name Surname');
  const programRaw = getField('Major Program');
  const email = getField('Email');

  // Translate Kazakh program name to English
  let major = null, year = null;
  if (programRaw) {
    const yearMatch = programRaw.match(/\/\s*(\d{4})/);
    if (yearMatch) {
      const startYear = parseInt(yearMatch[1]);
      const currentYear = new Date().getFullYear();
      const n = Math.max(1, currentYear - startYear + 1);
      year = n + (['st','nd','rd'][n-1]||'th') + ' Year';
    }
    if (programRaw.includes('EN')) {
      major = 'Software Engineering (EN)';
    } else if (programRaw.includes('RU')) {
      major = 'Software Engineering (RU)';
    } else if (programRaw.includes('KZ')) {
      major = 'Software Engineering (KZ)';
    } else {
      major = programRaw.replace(/\/\s*\d{4}.*$/, '').trim();
    }
  }

  const photoMatch = html.match(/stud_photo\.php\?[^"'\s>]+/);
  const photo = photoMatch ? PORTAL + '/' + photoMatch[0] : null;

  // Get GPA from transcript
  let gpa = null;
  if (transcriptHtml) {
    const gpaMatch = transcriptHtml.match(/Cumulative\s+GPA[^<\d]*([\d]+\.[\d]+)/i) ||
                     transcriptHtml.match(/GPA[^<\d]*([\d]+\.[\d]+)/i) ||
                     transcriptHtml.match(/([\d]+\.[\d]+)\s*<\/td>\s*<\/tr>\s*<\/table>/i);
    if (gpaMatch) gpa = gpaMatch[1];
  }

  return { name, major, year, email, photo, gpa };
}

function parseCurriculum(html) {
  if (!html) return [];
  const courses = [];
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  rows.forEach(function(row) {
    const cells = [];
    (row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).forEach(function(cell) {
      cells.push(cell.replace(/<[^>]+>/g, '').replace(/&nbsp;?/g, '').replace(/\s+/g, ' ').trim());
    });
    if (cells.length >= 3 && cells[1] && /^[A-Z]{2,4}\s*\d+/.test(cells[1])) {
      courses.push({
        code: cells[1],
        name: cells[2] || '',
        credits: (cells[4] || '').replace(/\+0$/, ''),
        grade: (cells[6] || '').replace(/\s+/g, ' ').trim(),
        status: (cells[8] || '').replace(/\s+/g, ' ').trim(),
      });
    }
  });
  return courses;
}

function parseGrades(html) {
  if (!html) return [];
  const grades = [];
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  rows.forEach(function(row) {
    const cells = [];
    (row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).forEach(function(cell) {
      cells.push(cell.replace(/<[^>]+>/g, '').replace(/&nbsp;?/g, '').replace(/\s+/g, ' ').trim());
    });
    if (cells.length >= 5 && /^\d+$/.test(cells[0])) {
      grades.push({
        no: cells[0],
        semester: cells[1] || '',
        code: cells[2] || '',
        name: cells[3] || '',
        credits: cells[4] || '',
        grade: cells[5] || '',
        gpa: cells[6] || '',
      });
    }
  });
  return grades;
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('SDU Proxy running on port ' + PORT));
