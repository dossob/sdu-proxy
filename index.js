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
    function cs() { return Object.entries(jar).map(([k,v]) => k+'='+v).join('; '); }

    // Step 1: GET homepage
    const r1 = await fetch(PORTAL + '/', { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' });
    parseCookies(r1.headers);

    // Step 2: POST login
    const r2 = await fetch(PORTAL + '/loginAuth.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cs(), 'User-Agent': 'Mozilla/5.0', 'Referer': PORTAL + '/', 'Origin': PORTAL },
      body: new URLSearchParams({ username: cleanUser, password, modstring: '', LogIn: 'Log in' }).toString(),
      redirect: 'manual',
    });
    parseCookies(r2.headers);

    if (!jar['uname']) return res.status(401).json({ error: 'Login failed. Wrong credentials.' });

    // Step 3: Follow redirect to index.php (important!)
    await fetch(PORTAL + '/index.php', {
      headers: { 'Cookie': cs(), 'User-Agent': 'Mozilla/5.0', 'Referer': PORTAL + '/loginAuth.php' },
      redirect: 'manual',
    });

    // Step 4: Fetch all pages in parallel
    const [profileHtml, transcriptHtml, currHtml] = await Promise.all([
      fetchPage(PORTAL + '/index.php?mod=profile', cs()),
      fetchPage(PORTAL + '/index.php?mod=transkript', cs()),
      fetchPage(PORTAL + '/index.php?mod=course_struct', cs()),
    ]);

    const student = parseProfile(profileHtml, transcriptHtml);
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
    const res = await fetch(url, { headers: { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0', 'Referer': PORTAL + '/index.php' } });
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

  let major = null, year = null;
  if (programRaw) {
    const yearMatch = programRaw.match(/\/\s*(\d{4})/);
    if (yearMatch) {
      const n = Math.max(1, new Date().getFullYear() - parseInt(yearMatch[1]) + 1);
      year = n + (['st','nd','rd'][n-1]||'th') + ' Year';
    }
    major = programRaw.includes('EN') ? 'Software Engineering (EN)' :
            programRaw.includes('RU') ? 'Software Engineering (RU)' :
            programRaw.includes('KZ') ? 'Software Engineering (KZ)' :
            programRaw.replace(/\/\s*\d{4}.*$/, '').trim();
  }

  const photoMatch = html.match(/stud_photo\.php\?[^"'\s>]+/);
  const photo = photoMatch ? PORTAL + '/' + photoMatch[0] : null;

  // GPA from transcript
  let gpa = null;
  if (transcriptHtml) {
    const m = transcriptHtml.match(/Grand\s+(?:Average\s+)?GPA\s*:\s*([\d.]+)/i) ||
              transcriptHtml.match(/GPA\s*:\s*([\d.]+)/i);
    if (m) gpa = m[1];
  }

  return { name, major, year, email, photo, gpa };
}

function parseCurriculum(html) {
  if (!html) return [];
  const courses = [];
  (html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []).forEach(function(row) {
    const cells = [];
    (row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).forEach(function(cell) {
      cells.push(cell.replace(/<[^>]+>/g, '').replace(/&nbsp;?/g, '').replace(/\s+/g, ' ').trim());
    });
    if (cells.length >= 3 && cells[1] && /^[A-Z]{2,4}\s*\d+/.test(cells[1])) {
      courses.push({
        code: cells[1], name: cells[2]||'',
        credits: (cells[4]||'').replace(/\+0$/,''),
        grade: (cells[6]||'').replace(/\s+/g,' ').trim(),
        status: (cells[8]||'').replace(/\s+/g,' ').trim(),
      });
    }
  });
  return courses;
}

function parseGrades(html) {
  if (!html) return [];
  const grades = [];
  (html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []).forEach(function(row) {
    const cells = [];
    (row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).forEach(function(cell) {
      cells.push(cell.replace(/<[^>]+>/g, '').replace(/&nbsp;?/g, '').replace(/\s+/g, ' ').trim());
    });
    if (cells.length >= 5 && /^\d+$/.test(cells[0]) && cells[2] && /^[A-Z]{2,4}\s*\d+/.test(cells[2])) {
      grades.push({ no: cells[0], code: cells[2], name: cells[3]||'', credits: cells[4]||'', score: cells[5]||'', grade: cells[6]||'', gpa: cells[7]||'', status: cells[8]||'' });
    }
  });
  return grades;
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('SDU Proxy running on port ' + PORT));
