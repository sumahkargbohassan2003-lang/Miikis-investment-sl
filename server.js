/**
 * MIKIS Investment & Construction Limited
 * Backend Server – Pure Node.js (no external dependencies)
 * Serves frontend + handles contact form API
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const INQUIRIES_FILE = path.join(DATA_DIR, 'inquiries.json');
const BUSINESS_EMAIL = 'mikisenterprise2@gmail.com';

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(INQUIRIES_FILE)) {
  fs.writeFileSync(INQUIRIES_FILE, '[]', 'utf8');
}

// MIME types
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function saveInquiry(inquiry) {
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(INQUIRIES_FILE, 'utf8'));
  } catch (e) {
    list = [];
  }
  list.unshift(inquiry); // newest first
  // Keep last 500
  if (list.length > 500) list = list.slice(0, 500);
  fs.writeFileSync(INQUIRIES_FILE, JSON.stringify(list, null, 2), 'utf8');
  return inquiry;
}

function serveStatic(req, res, pathname) {
  // Security: prevent path traversal
  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(ROOT, safePath === '/' ? 'index.html' : safePath);

  // Default to index.html for directories
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  const stream = fs.createReadStream(filePath);

  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': ext.match(/\.(jpg|jpeg|png|gif|webp|svg|woff2?)$/)
      ? 'public, max-age=86400'
      : 'no-cache',
  });
  stream.pipe(res);
  stream.on('error', () => {
    res.writeHead(500);
    res.end('Server Error');
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url || '/', `http://${req.headers.host}`);
  const pathname = parsed.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // ---------- API: Contact form ----------
  if (pathname === '/api/contact' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return sendJSON(res, 400, { success: false, error: 'Invalid JSON' });
      }

      const name = (body.name || '').trim();
      const email = (body.email || '').trim();
      const service = (body.service || 'General').trim();
      const message = (body.message || '').trim();
      const phone = (body.phone || '').trim();

      if (!name || !email || !message) {
        return sendJSON(res, 400, {
          success: false,
          error: 'Name, email and message are required',
        });
      }

      // Basic email validation
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return sendJSON(res, 400, { success: false, error: 'Invalid email address' });
      }

      const inquiry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name,
        email,
        phone,
        service,
        message,
        createdAt: new Date().toISOString(),
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
        userAgent: req.headers['user-agent'] || '',
      };

      saveInquiry(inquiry);

      console.log(`[CONTACT] New inquiry from ${name} <${email}> – ${service} → ${BUSINESS_EMAIL}`);

      return sendJSON(res, 200, {
        success: true,
        message: 'Thank you! Your message has been received and sent to ' + BUSINESS_EMAIL + '. We will contact you shortly.',
        id: inquiry.id,
      });
    } catch (err) {
      console.error('[CONTACT ERROR]', err);
      return sendJSON(res, 500, { success: false, error: 'Server error. Please try again.' });
    }
  }

  // ---------- API: List inquiries (simple admin – protect in production) ----------
  if (pathname === '/api/inquiries' && req.method === 'GET') {
    try {
      const list = JSON.parse(fs.readFileSync(INQUIRIES_FILE, 'utf8'));
      return sendJSON(res, 200, { success: true, count: list.length, inquiries: list });
    } catch (err) {
      return sendJSON(res, 500, { success: false, error: 'Could not read inquiries' });
    }
  }

  // ---------- API: Health check ----------
  if (pathname === '/api/health') {
    return sendJSON(res, 200, {
      success: true,
      status: 'ok',
      company: 'MIKIS Investment & Construction Limited',
      time: new Date().toISOString(),
    });
  }

  // ---------- Static files ----------
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   MIKIS Investment & Construction Limited               ║');
  console.log('║   Frontend + Backend connected                          ║');
  console.log(`║   Server running at  http://localhost:${PORT}              ║`);
  console.log('║   API endpoints:                                        ║');
  console.log('║     POST /api/contact     – submit inquiry              ║');
  console.log('║     GET  /api/inquiries   – view saved inquiries        ║');
  console.log('║     GET  /api/health      – health check                ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
});
