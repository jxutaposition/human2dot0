// Local dev server + Notion proxy for the pilot form
// Run: node api/pilot-form.js
// Serves the static site on http://localhost:3000
// Handles POST /api/pilot-form → writes to Notion database

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

async function createNotionPage(data) {
  const body = JSON.stringify({
    parent: { database_id: NOTION_DATABASE_ID },
    properties: {
      Name: {
        title: [{ text: { content: data.name } }],
      },
      Email: {
        email: data.email,
      },
      'Connection Type': {
        multi_select: [{ name: data.role }],
      },
      Craft: {
        select: data.org ? { name: data.org } : null,
      },
      'Reason to Chat': {
        rich_text: [{ text: { content: data.usecase } }],
      },
      'Added to Pilot': {
        checkbox: true,
      },
    },
  });

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion API error ${res.status}: ${err}`);
  }
  return await res.json();
}

const server = http.createServer(async (req, res) => {
  // Handle pilot form POST
  if (req.method === 'POST' && req.url === '/api/pilot-form') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        await createNotionPage(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        console.error('Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Serve static files
  let filePath = path.join(__dirname, '..', req.url === '/' ? 'index.html' : req.url);
  if (!path.extname(filePath)) filePath += '.html';

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Dev server running at http://localhost:${PORT}`);
  console.log(`Notion DB: ${NOTION_DATABASE_ID}`);
});
