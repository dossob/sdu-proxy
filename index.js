const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const PORTAL = 'https://my.sdu.edu.kz';

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', service: 'sdu-proxy' }));

// Login + get profile
app.post('/portal/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'credentials required' });

    const cleanUser = username.includes('@') ? username.split('@')[0] : username;

    const loginRes = await fetch(`${PORTAL}/loginAuth.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': `${PORTAL}/index.php`,
        'Origin': PORTAL,
      },
      body: new URLSearchParams({
        username: cleanUser,
        password,
        modstring: '',
        LogIn: 'Log in',
      }).toString(),
      redirect: 'manual',
    });

    const setCookieHeaders = loginRes.headers.raw()['set-cookie'] || [];
    const cookieHeader = setCookieHeaders.map(c => c.split(';')[0]).join('; ');

    if (!cookieHeader || !cookieHeader.includes('PHPSESSID')) {
      return res.status(401).json({ error: 'Login failed. Check credentials.' });
    }

    const homeRes = await fetch(`${PORTAL}/index.php`, {
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0',
      },
    });

    const html = await homeRes.text();
    const student = parseProfile(html);

    // Get curriculum
    const curriculumHtml = await fetchPage(`${PORTAL}/index.php?mod=course_struct`, cookieHeader);
    const curriculum = parseCurriculum(curriculumHtml);

    // Get grades
    const gradesHtml = await fetchPage(`${PORTAL}/index.php?mod=transcript`, cookieHeader);
    const grades = parseGrades(gradesHtml);

    res.json({ success: true, student, curriculum, grades });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not connect to SDU Portal' });
  }
});

async function fetchPage(url, cookie) {
  try {
    const res = await fetch(url, {
      headers: { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0' },
    });
    return await res.text();
  } catch { return ''; }
}

function parseProfile(html) {
  function getField(label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped + '[^<]*<\\/td>\\s*<td[^>]*>\\s*([^<]{1,120})', 'i');
    const m = html.match(re);
    return m ? m[1].trim() : null;
  }

  const name = getField('Fullname');
  const program = getField('Program / Class') || getField('Program');
  const email = getField('Email');
  const studentId = getField('Student');

  let major = null, year = null;
  if (program) {
    const yearMatch = program.match(/-\s*(\d+)\s*$/);
    if (yearMatch) {
      const n = parseInt(yearMatch[1]);
      const suffix = ['st','nd','rd'][n-1] || 'th';
      year = `${n}${suffix} Year`;
      major = program.replace(/-\s*\d+\s*$/, '').trim();
    } else {
      major = program;
    }
  }

  const photoMatch = html.match(/stud_photo\.php\?[^"'\s]+/);
  const photo = photoMatch ? `${PORTAL}/${photoMatch[0]}` : null;

  const gpaMatch = html.match(/GPA[^>]*>\s*([\d.]+)/i);
  const gpa = gpaMatch ? gpaMatch[1] : null;

  return { name, major, year, email, studentId, photo, gpa };
}

function parseCurriculum(html) {
  if (!html) return [];
  const courses = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const row = rowMatch[1];
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(row)) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
    }
    if (cells.length >= 4 && cells[1] && cells[1].match(/^[A-Z]{2,4}\s*\d+/)) {
      courses.push({
        code: cells[1],
        name: cells[2] || '',
        credits: cells[4] || '',
        grade: cells[6] || '',
        status: cells[8] || '',
      });
    }
  }
  return courses;
}

function parseGrades(html) {
  if (!html) return [];
  const grades = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const row = rowMatch[1];
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(row)) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
    }
    if (cells.length >= 3 && cells[0] && cells[0].match(/^\d+$/)) {
      grades.push({
        semester: cells[1] || '',
        code: cells[2] || '',
        name: cells[3] || '',
        credits: cells[4] || '',
        grade: cells[5] || '',
        gpa: cells[6] || '',
      });
    }
  }
  return grades;
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`SDU Proxy running on port ${PORT}`));
