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

// Map form field names to Notion database property names
const FIELD_MAP = {
  name: 'Name',
  email: 'Email',
  role: 'Connection Type',
  org: 'Craft',
  usecase: 'Reason to Chat',
};

// Cache the database schema so we only fetch it once
let dbSchema = null;

async function notionFetch(endpoint, options = {}) {
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion API error ${res.status}: ${err}`);
  }
  return res.json();
}

async function getDbSchema() {
  if (dbSchema) return dbSchema;
  const db = await notionFetch(`/databases/${NOTION_DATABASE_ID}`);
  dbSchema = db.properties;
  console.log('Database properties:', Object.keys(dbSchema).join(', '));
  return dbSchema;
}

function buildPropertyValue(propSchema, value) {
  if (!value) return null;
  switch (propSchema.type) {
    case 'title':
      return { title: [{ text: { content: value } }] };
    case 'rich_text':
      return { rich_text: [{ text: { content: value } }] };
    case 'email':
      return { email: value };
    case 'url':
      return { url: value };
    case 'number':
      return { number: Number(value) };
    case 'checkbox':
      return { checkbox: Boolean(value) };
    case 'select':
      return { select: { name: value } };
    case 'multi_select':
      return { multi_select: [{ name: value }] };
    case 'phone_number':
      return { phone_number: value };
    default:
      return null;
  }
}

async function createNotionPage(data) {
  const schema = await getDbSchema();
  const properties = {};
  const unmapped = [];

  // Always set Added to Pilot
  if (schema['Added to Pilot']) {
    properties['Added to Pilot'] = { checkbox: true };
  }

  for (const [formField, value] of Object.entries(data)) {
    if (!value) continue;

    const notionProp = FIELD_MAP[formField];
    const propSchema = notionProp && schema[notionProp];

    if (propSchema) {
      const propValue = buildPropertyValue(propSchema, value);
      if (propValue) {
        properties[notionProp] = propValue;
      } else {
        unmapped.push({ field: formField, value });
      }
    } else {
      unmapped.push({ field: formField, value });
    }
  }

  // Build page content blocks for unmapped fields
  const children = [];
  if (unmapped.length > 0) {
    children.push({
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: [{ text: { content: 'Additional Form Responses' } }],
      },
    });
    for (const { field, value } of unmapped) {
      children.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            { text: { content: `${field}: ` }, annotations: { bold: true } },
            { text: { content: value } },
          ],
        },
      });
    }
  }

  const body = { parent: { database_id: NOTION_DATABASE_ID }, properties };
  if (children.length > 0) body.children = children;

  return notionFetch('/pages', {
    method: 'POST',
    body: JSON.stringify(body),
  });
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
