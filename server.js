const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { scanDomain } = require('./lib/cdx');
const Downloader = require('./lib/downloader');
const { getDomain, parseWaybackUrl } = require('./lib/utils');

const app = express();
const PORT = 3000;
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve downloaded files
app.use('/downloads', express.static(DOWNLOADS_DIR));

// Active downloader & SSE clients
let activeDownloader = null;
const sseClients = [];

// Parse Wayback URL
app.post('/api/parse', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL diperlukan' });

  const parsed = parseWaybackUrl(url);
  if (!parsed) return res.json({ isWayback: false });

  res.json({
    isWayback: true,
    timestamp: parsed.timestamp,
    originalUrl: parsed.originalUrl,
    domain: getDomain(parsed.originalUrl)
  });
});

// Scan domain - cari semua halaman yang tersedia
app.post('/api/scan', async (req, res) => {
  try {
    let { url, from, to, limit } = req.body;
    if (!url) return res.status(400).json({ error: 'URL diperlukan' });

    // Auto-parse jika URL wayback (extract domain, tapi jangan batasi timestamp)
    const parsed = parseWaybackUrl(url);
    if (parsed) {
      url = parsed.originalUrl;
    }

    const results = await scanDomain(url, { from, to, limit: limit || 500 });
    res.json({ domain: getDomain(url), pages: results, timestamp: parsed?.timestamp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mulai download
app.post('/api/download', async (req, res) => {
  try {
    const { pages, timestamp } = req.body;
    if (!pages || pages.length === 0) {
      return res.status(400).json({ error: 'Pilih minimal 1 halaman' });
    }

    if (activeDownloader && activeDownloader.progress.status === 'downloading') {
      return res.status(409).json({ error: 'Download sedang berjalan' });
    }

    activeDownloader = new Downloader();
    activeDownloader.onProgress((progress) => {
      for (const client of sseClients) {
        client.write(`data: ${JSON.stringify(progress)}\n\n`);
      }
    });

    res.json({ message: 'Download dimulai', total: pages.length });

    // Run download in background
    activeDownloader.downloadSite(pages, timestamp).catch(err => {
      console.error('Download error:', err);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SSE endpoint untuk progress
app.get('/api/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  sseClients.push(res);

  // Kirim status awal
  if (activeDownloader) {
    res.write(`data: ${JSON.stringify(activeDownloader.progress)}\n\n`);
  } else {
    res.write(`data: ${JSON.stringify({ status: 'idle', total: 0, done: 0, current: '' })}\n\n`);
  }

  req.on('close', () => {
    const idx = sseClients.indexOf(res);
    if (idx >= 0) sseClients.splice(idx, 1);
  });
});

// List semua hasil download
app.get('/api/downloads', (req, res) => {
  try {
    if (!fs.existsSync(DOWNLOADS_DIR)) {
      return res.json({ sites: [] });
    }

    const sites = fs.readdirSync(DOWNLOADS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        const sitePath = path.join(DOWNLOADS_DIR, d.name);
        return {
          domain: d.name,
          path: `/downloads/${d.name}`,
          files: countFiles(sitePath)
        };
      });

    res.json({ sites });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete site
app.delete('/api/downloads/:domain', (req, res) => {
  const domain = req.params.domain.replace(/[^a-zA-Z0-9._-]/g, '');
  const siteDir = path.join(DOWNLOADS_DIR, domain);

  if (!fs.existsSync(siteDir)) {
    return res.status(404).json({ error: 'Site tidak ditemukan' });
  }

  try {
    fs.rmSync(siteDir, { recursive: true, force: true });
    res.json({ message: `${domain} berhasil dihapus` });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus: ' + err.message });
  }
});

// Download sebagai ZIP
app.get('/api/zip/:domain', (req, res) => {
  const domain = req.params.domain.replace(/[^a-zA-Z0-9._-]/g, '');
  const siteDir = path.join(DOWNLOADS_DIR, domain);

  if (!fs.existsSync(siteDir)) {
    return res.status(404).json({ error: 'Site tidak ditemukan' });
  }

  const zipName = `${domain}.zip`;
  const zipPath = path.join(DOWNLOADS_DIR, zipName);

  try {
    // Hapus zip lama jika ada
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

    // Buat zip pakai command line
    execSync(`cd "${DOWNLOADS_DIR}" && zip -r "${zipName}" "${domain}"`, { stdio: 'pipe' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const stream = fs.createReadStream(zipPath);
    stream.pipe(res);
    stream.on('end', () => {
      // Hapus zip setelah dikirim
      try { fs.unlinkSync(zipPath); } catch { }
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal membuat ZIP: ' + err.message });
  }
});

function countFiles(dir) {
  let count = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        count += countFiles(path.join(dir, entry.name));
      } else {
        count++;
      }
    }
  } catch { /* skip */ }
  return count;
}

app.listen(PORT, () => {
  console.log(`Wayback HTML Machine berjalan di http://localhost:${PORT}`);
});
