require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch');
const OpenAI = require('openai');
const crypto = require('crypto');
const db = require('./supabase'); // <-- Endi barcha doimiy ma'lumotlar (o'quvchilar, savollar,
                                   //     sozlamalar) shu modul orqali Supabase'da saqlanadi.

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.OPENAI_API_KEY) {
  console.warn('DIQQAT: .env faylida OPENAI_API_KEY topilmadi. AI baholash ishlamaydi (talabalar javobi "o\'qituvchi tekshiradi" holatida qoladi).');
}

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// Audio javoblar base64 shaklida JSON orqali yuborilgani uchun limit kattaroq qilindi.
app.use(express.json({ limit: '30mb' }));
app.use(express.static(path.join(__dirname)));

// Bu papka faqat Gapirish (Whisper) uchun VAQTINCHALIK audio faylni saqlaydi va darhol
// o'chiriladi — talabalar ma'lumoti bu yerda SAQLANMAYDI, shuning uchun Supabase'ga
// ko'chirilmaydi.
const uploadDir = path.join(__dirname, 'tmp_uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const upload = multer({ dest: uploadDir, limits: { fileSize: 20 * 1024 * 1024 } });

const TEST_KEYS = ['Grammatika', 'Tinglash', 'O\u2018qish', 'Yozish', 'Gapirish'];

// Birinchi marta ishga tushirilganda savollar banki bo'sh bo'lsa, shu standart savollar
// bilan to'ldiriladi (avval mahalliy faylda bo'lgani kabi). Faqat BIR MARTA amalga oshadi —
// `settings.questionsSeeded` belgisi orqali kuzatiladi, shunda o'qituvchi keyinchalik barcha
// savollarni ataylab o'chirib tashlasa, ular qayta avtomatik qo'shilib qolmaydi.
const DEFAULT_QUESTIONS = {
  Grammatika: [
    { id: 'g1', prompt: '\u201cMen o\u2018quvchiman\u201d jumlasining to\u2018g\u2018ri tarjimasi qaysi?', options: ['\u042f \u0443\u0447\u0435\u043d\u0438\u043a.', '\u042f \u0443\u0447\u0438\u0442\u0435\u043b\u044c.', '\u042f \u0448\u043a\u043e\u043b\u0430.'], answer: '0' },
    { id: 'g2', prompt: 'Bo\u2018sh joyni to\u2018ldiring: \u042d\u0442\u043e ___ \u043a\u043d\u0438\u0433\u0430. (Bu chiroyli kitob.)', options: ['\u043a\u0440\u0430\u0441\u0438\u0432\u044b\u0439', '\u043a\u0440\u0430\u0441\u0438\u0432\u0430\u044f', '\u043a\u0440\u0430\u0441\u0438\u0432\u043e\u0435'], answer: '1' },
    { id: 'g3', prompt: '\u201cMen maktabga boraman\u201d jumlasini toping.', options: ['\u042f \u0448\u043a\u043e\u043b\u0430 \u0438\u0434\u0443.', '\u042f \u0438\u0434\u0443 \u0432 \u0448\u043a\u043e\u043b\u0443.', '\u042f \u0438\u0434\u0443 \u0448\u043a\u043e\u043b\u0430.'], answer: '1' },
    { id: 'g4', prompt: '\u201cKitoblar\u201d so\u2018zini rus tiliga tarjima qiling.', options: ['\u043a\u043d\u0438\u0433\u0438', '\u043a\u043d\u0438\u0433\u0430', '\u043a\u043d\u0438\u0433\u0430\u043c'], answer: '0' },
  ],
  Tinglash: [
    { id: 'l1', prompt: 'Gapirayotgan bolaning ismi nima?', audioText: '\u041f\u0440\u0438\u0432\u0435\u0442! \u041c\u0435\u043d\u044f \u0437\u043e\u0432\u0443\u0442 \u0410\u043b\u0438\u0448\u0435\u0440.', options: ['Alisher', 'Sardor', 'Kamola'], answer: '0' },
    { id: 'l2', prompt: 'Bugun haftaning qaysi kuni?', audioText: '\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u043f\u044f\u0442\u043d\u0438\u0446\u0430.', options: ['Dushanba', 'Chorshanba', 'Juma'], answer: '2' },
    { id: 'l3', prompt: 'U nimani yoqtiradi?', audioText: '\u042f \u043b\u044e\u0431\u043b\u044e \u0440\u0443\u0441\u0441\u043a\u0438\u0439 \u044f\u0437\u044b\u043a \u0438 \u0440\u0438\u0441\u043e\u0432\u0430\u0442\u044c.', options: ['Rus tili va rasm chizishni', 'Futbol o\u2018ynashni', 'Ingliz tilini'], answer: '0' },
  ],
  'O\u2018qish': [
    { id: 'r1', prompt: '\u201c\u0428\u043a\u043e\u043b\u0430\u201d so\u2018zi nimani anglatadi?', options: ['Oila', 'Do\u2018st', 'Maktab'], answer: '2' },
    { id: 'r2', prompt: '\u201c\u041c\u043d\u0435 10 \u043b\u0435\u0442\u201d gapining ma\u2019nosi qaysi?', options: ['Men 8 yoshdaman.', 'Men 10 yoshdaman.', 'Men 12 yoshdaman.'], answer: '1' },
    { id: 'r3', prompt: 'Alisher nimani yaxshi ko\u2018radi?', options: ['Rus tili va rasm chizishni', 'Futbol o\u2018ynashni', 'Ingliz tilini'], answer: '0' },
  ],
  Yozish: [
    { id: 'w1', prompt: 'So\u2018zlardan to\u2018g\u2018ri jumla tuzing: \u044f / \u0441\u0442\u0443\u0434\u0435\u043d\u0442 / \u043f\u0440\u0438\u043b\u0435\u0436\u043d\u044b\u0439' },
    { id: 'w2', prompt: 'Rus tilida ismingiz, sinfingiz va rus tilini yoqtirasizmi yoki yo\u2018qligi haqida 2\u20133 ta sodda gap yozing.' },
    { id: 'w3', prompt: '\u201cBugun havo yaxshi.\u201d jumlasini rus tiliga tarjima qiling.' },
  ],
  Gapirish: [
    { id: 's1', prompt: 'O\u2018zingizni rus tilida tanishtiring: ismingiz, sinfingiz va rus tili haqida 2\u20133 ta gap ayting.' },
  ],
};

const DEFAULT_SETTINGS = {
  gradingMode: 'teacher',
  adminUsername: 'admin',
  adminPassword: 'admin',
  readingPassage: { content: '', translation: '' },
  questionsSeeded: false,
};

async function getSettings() {
  return db.getSettings(DEFAULT_SETTINGS);
}
async function updateSettings(patch) {
  const current = await getSettings();
  const updated = { ...current, ...patch };
  await db.saveSettings(updated);
  return updated;
}

async function ensureQuestionsSeeded() {
  const settings = await getSettings();
  if (settings.questionsSeeded) return;
  for (const section of TEST_KEYS) {
    for (const question of DEFAULT_QUESTIONS[section] || []) {
      await db.addQuestion(question, section);
    }
  }
  await updateSettings({ questionsSeeded: true });
}

function sanitizeStudent(student) {
  if (!student) return student;
  const { password, ...rest } = student;
  return rest;
}

function maybeArchiveAttempt(student) {
  const allDone = TEST_KEYS.every(key => student.results[key] && !student.results[key].pending);
  if (!allDone) return student;
  const completedAt = student.results['Gapirish']?.completedAt || new Date().toISOString();
  student.attempts = student.attempts || [];
  if (student.attempts.some(attempt => attempt.id === completedAt)) return student;
  const snapshot = JSON.parse(JSON.stringify(student.results));
  student.attempts = [...student.attempts, { id: completedAt, completedAt, results: snapshot }].slice(-5);
  return student;
}

function isFullyGraded(student) {
  return TEST_KEYS.every(key => student.results && student.results[key] && !student.results[key].pending);
}

// ---------- Natija PDF'ini serverda tayyorlash (Telegramga avtomatik yuborish uchun) ----------
function pdfSafe(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019]/g, "'").replace(/[^\x20-\x7E]/g, '?').replace(/[\\()]/g, '\\$&');
}
function buildResultPdfBuffer(student) {
  const results = TEST_KEYS.map(key => student.results[key]);
  const labels = TEST_KEYS;
  const stream = [
    'q', '0.98 0.97 0.94 rg', '0 0 595 842 re f',
    '0.42 0.09 0.10 rg', '0 670 595 172 re f',
    '0.75 0.54 0.18 rg', '0 670 595 6 re f',
    'BT', '/F2 27 Tf', '1 1 1 rg', '57 774 Td', '(ANOR SCHOOL) Tj',
    '/F1 11 Tf', '0 -23 Td', '0.93 0.82 0.55 rg', '(RUSSIAN LANGUAGE DIAGNOSTIC REPORT) Tj',
    '/F1 10 Tf', '0 -48 Td', '1 1 1 rg', `(Student: ${pdfSafe(student.fullName)}) Tj`,
    '0 -17 Td', `(Class: ${pdfSafe(student.schoolClass)}) Tj`,
    '255 17 Td', `(Date: ${new Date().toLocaleDateString('en-CA')}) Tj`, 'ET',
    '0.42 0.09 0.10 rg', 'BT', '/F2 18 Tf', '57 625 Td', '(Assessment summary) Tj',
    '/F1 10 Tf', '0 -18 Td', '0.35 0.40 0.42 rg', '(Results from the completed Russian language diagnostic.) Tj', 'ET',
    '0.42 0.09 0.10 rg', '57 556 481 34 re f',
    'BT', '/F2 10 Tf', '1 1 1 rg', '73 569 Td', '(SKILL) Tj', '315 0 Td', '(RESULT) Tj', 'ET'
  ];
  results.forEach((result, index) => {
    const y = 512 - index * 48; const fill = index % 2 === 0 ? '0.94 0.94 0.91' : '0.98 0.97 0.94';
    const score = result && result.pending ? 'Teacher review pending' : `${result.score} / ${result.total}`;
    stream.push(fill + ' rg', `57 ${y} 481 47 re f`, '0.75 0.54 0.18 rg', `57 ${y} 5 47 re f`,
      '0.25 0.08 0.06 rg', 'BT', '/F2 12 Tf', `75 ${y + 19} Td`, `(${pdfSafe(labels[index])}) Tj`, '/F1 9 Tf', '0 -13 Td', `(Russian language skill ${index + 1}) Tj`, 'ET',
      '0.25 0.08 0.06 rg', 'BT', '/F2 12 Tf', `378 ${y + 18} Td`, `(${pdfSafe(score)}) Tj`, 'ET');
  });
  stream.push('0.75 0.54 0.18 rg', '57 234 481 1 re f',
    '0.25 0.08 0.06 rg', 'BT', '/F2 11 Tf', '57 204 Td', '(Teacher review) Tj',
    '/F1 9 Tf', '0 -15 Td', '0.35 0.40 0.42 rg', '(Writing and speaking scores are confirmed after teacher review.) Tj',
    '0.25 0.08 0.06 rg', '0 -105 Td', '(ANOR INTERNATIONAL SCHOOL) Tj',
    '0.35 0.40 0.42 rg', '0 -14 Td', '(Russian Language Programme - Student Assessment Report) Tj', 'ET', 'Q');
  const content = stream.join('\n');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
  let pdf = '%PDF-1.4\n'; const offsets = [0]; objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }); const xref = pdf.length; pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}

async function sendTelegramDocument(buffer, filename, caption) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    throw new Error('Telegram sozlanmagan (.env faylida TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID yo\u2018q).');
  }
  const form = new FormData();
  form.append('chat_id', process.env.TELEGRAM_CHAT_ID);
  if (caption) form.append('caption', caption);
  form.append('document', buffer, { filename, contentType: 'application/pdf' });
  const telegramUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendDocument`;
  const response = await fetch(telegramUrl, { method: 'POST', body: form });
  const data = await response.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || 'Telegram xatosi.');
}

async function finalizeIfComplete(student) {
  if (!isFullyGraded(student)) return;
  if (student.telegramSent) return;
  try {
    const buffer = buildResultPdfBuffer(student);
    const filename = `Anor-School-natija-${student.fullName.replace(/[^a-z0-9]+/gi, '-')}.pdf`;
    const caption = `${student.fullName} \u2014 ${student.schoolClass} sinf\nRus tili diagnostikasi natijasi`;
    await sendTelegramDocument(buffer, filename, caption);
    student.telegramSent = true;
    student.telegramError = null;
  } catch (err) {
    student.telegramSent = false;
    student.telegramError = err.message || 'Telegramga yuborishda xatolik.';
  }
}

// ---------- O'quvchilar: ro'yxatdan o'tish / kirish / ro'yxat ----------
app.get('/api/students', async (req, res) => {
  try {
    const students = await db.getStudents();
    res.json(students.map(sanitizeStudent));
  } catch (err) {
    console.error('GET /api/students error:', err.message);
    res.status(500).json({ error: 'server-error' });
  }
});

app.get('/api/students/:id', async (req, res) => {
  try {
    const student = await db.getStudent(req.params.id);
    if (!student) return res.status(404).json({ error: 'not-found' });
    maybeArchiveAttempt(student);
    await finalizeIfComplete(student);
    await db.saveStudent(student);
    res.json(sanitizeStudent(student));
  } catch (err) {
    console.error('GET /api/students/:id error:', err.message);
    res.status(500).json({ error: 'server-error' });
  }
});

app.post('/api/register', async (req, res) => {
  const { fullName, schoolClass, password } = req.body || {};
  if (!fullName || !schoolClass || !password) return res.status(400).json({ error: 'invalid' });
  try {
    const settings = await getSettings();
    if (fullName.trim().toLowerCase() === settings.adminUsername.toLowerCase()) {
      return res.status(400).json({ error: 'admin-reserved' });
    }
    const students = await db.getStudents();
    const exists = students.some(item => item.fullName.toLowerCase() === fullName.trim().toLowerCase() && item.schoolClass === schoolClass);
    if (exists) return res.status(409).json({ error: 'duplicate' });

    const student = {
      id: crypto.randomUUID(),
      fullName: fullName.trim(),
      schoolClass,
      password,
      results: {},
      attempts: [],
      pendingReview: {},
      telegramSent: false,
      telegramError: null,
    };
    await db.saveStudent(student);
    res.json(sanitizeStudent(student));
  } catch (err) {
    console.error('POST /api/register error:', err.message);
    // Bir vaqtda ikkita so'rov kelib qolsa, Supabase'dagi unikal indeks
    // (full_name + school_class) shu yerda ishga tushishi mumkin.
    if (String(err.message || '').includes('duplicate')) return res.status(409).json({ error: 'duplicate' });
    res.status(500).json({ error: 'server-error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { fullName, password } = req.body || {};
  if (!fullName || !password) return res.status(400).json({ error: 'invalid' });
  try {
    const students = await db.getStudents();
    const student = students.find(item => item.fullName.toLowerCase() === fullName.trim().toLowerCase() && item.password === password);
    if (!student) return res.status(401).json({ error: 'invalid-credentials' });
    res.json(sanitizeStudent(student));
  } catch (err) {
    console.error('POST /api/login error:', err.message);
    res.status(500).json({ error: 'server-error' });
  }
});

app.post('/api/students/:id/result', async (req, res) => {
  const { section, score, total, note } = req.body || {};
  if (!section) return res.status(400).json({ error: 'invalid' });
  try {
    const student = await db.getStudent(req.params.id);
    if (!student) return res.status(404).json({ error: 'not-found' });
    student.results = { ...(student.results || {}), [section]: { score, total, note: note || '', pending: false, completedAt: new Date().toISOString() } };
    if (student.pendingReview?.[section]) { const rest = { ...student.pendingReview }; delete rest[section]; student.pendingReview = rest; }
    maybeArchiveAttempt(student);
    await finalizeIfComplete(student);
    await db.saveStudent(student);
    res.json(sanitizeStudent(student));
  } catch (err) {
    console.error('POST /api/students/:id/result error:', err.message);
    res.status(500).json({ error: 'server-error' });
  }
});

app.post('/api/students/:id/pending', async (req, res) => {
  const { section, total, content } = req.body || {};
  if (!section) return res.status(400).json({ error: 'invalid' });
  try {
    const student = await db.getStudent(req.params.id);
    if (!student) return res.status(404).json({ error: 'not-found' });
    student.results = { ...(student.results || {}), [section]: { score: null, total, note: '', pending: true, completedAt: new Date().toISOString() } };
    student.pendingReview = { ...(student.pendingReview || {}), [section]: content };
    await db.saveStudent(student);
    res.json(sanitizeStudent(student));
  } catch (err) {
    console.error('POST /api/students/:id/pending error:', err.message);
    res.status(500).json({ error: 'server-error' });
  }
});

app.post('/api/students/:id/grade', async (req, res) => {
  const { section, score, total, comment } = req.body || {};
  if (!section) return res.status(400).json({ error: 'invalid' });
  try {
    const student = await db.getStudent(req.params.id);
    if (!student) return res.status(404).json({ error: 'not-found' });
    const previous = student.results?.[section];
    student.results = { ...(student.results || {}), [section]: { score, total, note: comment || '', pending: false, completedAt: previous?.completedAt || new Date().toISOString() } };
    if (student.pendingReview?.[section]) { const rest = { ...student.pendingReview }; delete rest[section]; student.pendingReview = rest; }
    maybeArchiveAttempt(student);
    await finalizeIfComplete(student);
    await db.saveStudent(student);
    res.json(sanitizeStudent(student));
  } catch (err) {
    console.error('POST /api/students/:id/grade error:', err.message);
    res.status(500).json({ error: 'server-error' });
  }
});

app.post('/api/students/:id/reset', async (req, res) => {
  try {
    const student = await db.getStudent(req.params.id);
    if (!student) return res.status(404).json({ error: 'not-found' });
    await finalizeIfComplete(student); // oxirgi imkoniyat sifatida yana bir bor urinib ko'ramiz
    if (!isFullyGraded(student) || !student.telegramSent) {
      await db.saveStudent(student);
      return res.status(400).json({ error: 'not-ready' });
    }
    student.results = {};
    student.pendingReview = {};
    student.telegramSent = false;
    student.telegramError = null;
    await db.saveStudent(student);
    res.json(sanitizeStudent(student));
  } catch (err) {
    console.error('POST /api/students/:id/reset error:', err.message);
    res.status(500).json({ error: 'server-error' });
  }
});

// ---------- Savollar banki ----------
app.get('/api/questions', async (req, res) => {
  try {
    await ensureQuestionsSeeded();
    const bank = await db.getQuestionBank(TEST_KEYS);
    res.json(bank);
  } catch (err) {
    console.error('GET /api/questions error:', err.message);
    res.status(500).json({ error: 'server-error' });
  }
});

app.post('/api/questions', async (req, res) => {
  const { section, grade, prompt, audioText, audioUrl, options, answer } = req.body || {};
  const normalizedGrade = Number(grade);
  if (!section || !prompt || !Number.isInteger(normalizedGrade) || normalizedGrade < 1 || normalizedGrade > 11) return res.status(400).json({ error: 'invalid' });
  try {
    const question = { id: crypto.randomUUID(), grade: normalizedGrade, prompt };
    if (options) question.options = options;
    if (answer !== undefined) question.answer = answer;
    if (audioUrl) question.audioUrl = audioUrl;
    else if (audioText) question.audioText = audioText;
    await db.addQuestion(question, section);
    const bank = await db.getQuestionBank(TEST_KEYS);
    res.json(bank);
  } catch (err) {
    console.error('POST /api/questions error:', err.message);
    res.status(500).json({ error: 'server-error' });
  }
});

app.patch('/api/questions/:section/:id', async (req, res) => {
  const normalizedGrade = Number(req.body?.grade);
  if (!Number.isInteger(normalizedGrade) || normalizedGrade < 1 || normalizedGrade > 11) return res.status(400).json({ error: 'invalid' });
  try {
    await db.updateQuestionGrade(req.params.id, normalizedGrade);
    const bank = await db.getQuestionBank(TEST_KEYS);
    res.json(bank);
  } catch (err) {
    console.error('PATCH /api/questions error:', err.message);
    res.status(500).json({ error: 'server-error' });
  }
});

app.delete('/api/questions/:section/:id', async (req, res) => {
  try {
    await db.removeQuestion(req.params.id);
    const bank = await db.getQuestionBank(TEST_KEYS);
    res.json(bank);
  } catch (err) {
    console.error('DELETE /api/questions error:', err.message);
    res.status(500).json({ error: 'server-error' });
  }
});

app.get('/api/reading-passage', async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings.readingPassage || { content: '', translation: '' });
  } catch (err) {
    console.error('GET /api/reading-passage error:', err.message);
    res.status(500).json({ error: 'server-error' });
  }
});

app.post('/api/reading-passage', async (req, res) => {
  const { content, translation } = req.body || {};
  if (typeof content !== 'string' || typeof translation !== 'string') return res.status(400).json({ error: 'invalid' });
  try {
    const settings = await updateSettings({ readingPassage: { content: content.trim(), translation: translation.trim() } });
    res.json(settings.readingPassage);
  } catch (err) {
    console.error('POST /api/reading-passage error:', err.message);
    res.status(500).json({ error: 'server-error' });
  }
});

// ---------- Baholash rejimi (AI / Ustoz) ----------
app.get('/api/grading-mode', async (req, res) => {
  try {
    const settings = await getSettings();
    res.json({ mode: settings.gradingMode });
  } catch (err) {
    console.error('GET /api/grading-mode error:', err.message);
    res.status(500).json({ error: 'server-error' });
  }
});

app.post('/api/grading-mode', async (req, res) => {
  const { mode } = req.body || {};
  if (mode !== 'ai' && mode !== 'teacher') return res.status(400).json({ error: 'invalid' });
  try {
    const settings = await updateSettings({ gradingMode: mode });
    res.json({ mode: settings.gradingMode });
  } catch (err) {
    console.error('POST /api/grading-mode error:', err.message);
    res.status(500).json({ error: 'server-error' });
  }
});

// ---------- Admin: kirish va login/parolni o'zgartirish ----------
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'invalid' });
  try {
    const settings = await getSettings();
    if (username.trim().toLowerCase() !== settings.adminUsername.toLowerCase()) return res.status(404).json({ error: 'invalid-username' });
    if (password !== settings.adminPassword) return res.status(401).json({ error: 'invalid-password' });
    res.json({ ok: true, username: settings.adminUsername });
  } catch (err) {
    console.error('POST /api/admin/login error:', err.message);
    res.status(500).json({ error: 'server-error' });
  }
});

app.post('/api/admin/credentials', async (req, res) => {
  const { currentPassword, newUsername, newPassword } = req.body || {};
  if (!currentPassword) return res.status(400).json({ error: 'invalid' });
  try {
    const settings = await getSettings();
    if (currentPassword !== settings.adminPassword) return res.status(401).json({ error: 'invalid-password' });
    const patch = {};
    const trimmedUsername = (newUsername || '').trim();
    if (trimmedUsername) {
      const students = await db.getStudents();
      const conflict = students.some(student => student.fullName.toLowerCase() === trimmedUsername.toLowerCase());
      if (conflict) return res.status(409).json({ error: 'duplicate-username' });
      patch.adminUsername = trimmedUsername;
    }
    const trimmedPassword = (newPassword || '').trim();
    if (trimmedPassword) {
      if (trimmedPassword.length < 4) return res.status(400).json({ error: 'password-too-short' });
      patch.adminPassword = trimmedPassword;
    }
    const updated = await updateSettings(patch);
    res.json({ ok: true, username: updated.adminUsername });
  } catch (err) {
    console.error('POST /api/admin/credentials error:', err.message);
    res.status(500).json({ error: 'server-error' });
  }
});

// ---------- Yozish (Writing) baholash ----------
app.post('/api/grade-writing', async (req, res) => {
  try {
    const { answers } = req.body; // [{ prompt, answer }]
    if (!Array.isArray(answers) || !answers.length) {
      return res.status(400).json({ error: 'answers required' });
    }

    const systemPrompt = `Siz rus tili (boshlang'ich daraja) o'qituvchisiz. O'quvchining yozma javoblarini baholaysiz.
Har bir javobni grammatika, so'z boyligi va topshiriqqa mosligiga qarab 0 dan 10 gacha ball bilan baholang.
Agar javob bo'sh yoki mutlaqo mos bo'lmasa, 0 ball qo'ying.
Faqat quyidagi JSON formatida javob bering, boshqa hech qanday matn yozmang:
{"items":[{"score": number, "maxScore": 10, "comment": "qisqa fikr o'zbek tilida"}],"totalScore": number, "totalMax": number, "overallComment": "umumiy fikr o'zbek tilida, 1-2 gap"}`;

    const userContent = answers
      .map((a, i) => `Topshiriq ${i + 1}: ${a.prompt}\nO'quvchi javobi: ${a.answer && a.answer.trim() ? a.answer.trim() : '(bo\'sh javob)'}`)
      .join('\n\n');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    res.json(parsed);
  } catch (err) {
    console.error('grade-writing error:', err.message);
    res.status(500).json({ error: 'AI baholashda xatolik yuz berdi.' });
  }
});

// ---------- Gapirish (Speaking) baholash ----------
app.post('/api/grade-speaking', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'audio file required' });
    const promptsText = req.body.prompts || '';

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: 'whisper-1',
      language: 'ru',
    });

    fs.unlink(req.file.path, () => {});

    const systemPrompt = `Siz rus tili o'qituvchisiz. Sizga o'quvchining ovozli javobi matnga o'girilgan holda (transkripsiya) beriladi.
Talaffuzni to'g'ridan-to'g'ri eshita olmaysiz, shuning uchun grammatika, so'z boyligi, gap tuzilishi va topshiriqqa mosligiga qarab baholang.
0 dan 10 gacha umumiy ball bering. Agar transkripsiya bo'sh yoki mavzuga mutlaqo aloqasi bo'lmasa, past ball bering.
Faqat quyidagi JSON formatida javob bering, boshqa hech narsa yozmang:
{"score": number, "maxScore": 10, "comment": "qisqa fikr o'zbek tilida, 1-2 gap"}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Topshiriq: ${promptsText}\n\nTranskripsiya: ${transcription.text || '(bo\'sh)'}` },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    parsed.transcript = transcription.text || '';
    res.json(parsed);
  } catch (err) {
    console.error('grade-speaking error:', err.message);
    res.status(500).json({ error: 'AI baholashda xatolik yuz berdi.' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server ishga tushdi: http://localhost:${PORT}`);
  console.log('Ma\u2019lumotlar endi Supabase\u2019da saqlanadi (SUPABASE_URL / SUPABASE_SECRET_KEY orqali).');
  console.log('Maktabdagi boshqa kompyuterlar shu tarmoqdagi IP orqali ulanadi, masalan: http://192.168.1.XX:' + PORT);
});
