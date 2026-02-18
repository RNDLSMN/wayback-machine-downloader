let scannedPages = [];
let eventSource = null;
let parsedWayback = null;

// Deteksi Wayback URL saat user mengetik/paste
document.getElementById('urlInput').addEventListener('input', async (e) => {
  const url = e.target.value.trim();
  const directBtn = document.getElementById('directBtn');
  const infoEl = document.getElementById('waybackInfo');

  if (url.match(/^https?:\/\/web\.archive\.org\/web\/\d+/)) {
    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await res.json();
      if (data.isWayback) {
        parsedWayback = data;
        directBtn.style.display = 'inline-block';
        showWaybackInfo(data);
        return;
      }
    } catch {}
  }

  parsedWayback = null;
  directBtn.style.display = 'none';
  hideWaybackInfo();
});

function showWaybackInfo(data) {
  let infoEl = document.getElementById('waybackInfo');
  if (!infoEl) {
    infoEl = document.createElement('div');
    infoEl.id = 'waybackInfo';
    infoEl.style.cssText = 'margin-top:10px;padding:10px 14px;background:#0d2818;border:1px solid #00ff88;border-radius:6px;font-size:13px;color:#aaa;';
    document.querySelector('.input-section').appendChild(infoEl);
  }
  const ts = data.timestamp;
  const date = `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)} ${ts.slice(8,10)}:${ts.slice(10,12)}:${ts.slice(12,14)}`;
  infoEl.innerHTML = `
    <span style="color:#00ff88;font-weight:600">Wayback URL terdeteksi!</span><br>
    <span style="color:#ccc">URL Asli:</span> ${data.originalUrl}<br>
    <span style="color:#ccc">Timestamp:</span> ${date}<br>
    <span style="color:#ccc">Domain:</span> ${data.domain}<br>
    <span style="color:#888;font-size:11px;margin-top:4px;display:block">
      Klik <b>Download Langsung</b> untuk download halaman ini + semua asset-nya, atau <b>Scan</b> untuk cari semua halaman di domain ini.
    </span>
  `;
  infoEl.style.display = 'block';
}

function hideWaybackInfo() {
  const infoEl = document.getElementById('waybackInfo');
  if (infoEl) infoEl.style.display = 'none';
}

// Direct download - langsung download 1 halaman dari Wayback URL
async function directDownload() {
  if (!parsedWayback) return alert('URL Wayback tidak valid');

  const directBtn = document.getElementById('directBtn');
  directBtn.disabled = true;
  directBtn.innerHTML = '<span class="spinner"></span>Downloading...';

  document.getElementById('progressSection').classList.add('visible');
  document.getElementById('progressErrors').innerHTML = '';
  connectSSE();

  try {
    const pages = [{
      timestamp: parsedWayback.timestamp,
      original: parsedWayback.originalUrl
    }];

    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages, timestamp: parsedWayback.timestamp })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
  } catch (err) {
    alert('Download gagal: ' + err.message);
  } finally {
    directBtn.disabled = false;
    directBtn.textContent = 'Download Langsung';
  }
}

// Scan domain
async function startScan() {
  const url = document.getElementById('urlInput').value.trim();
  if (!url) return alert('Masukkan URL terlebih dahulu');
  localStorage.setItem('lastUrl', url);

  const scanBtn = document.getElementById('scanBtn');
  scanBtn.disabled = true;
  scanBtn.innerHTML = '<span class="spinner"></span>Scanning...';

  try {
    const body = { url };
    const from = document.getElementById('fromDate').value.trim();
    const to = document.getElementById('toDate').value.trim();
    const limit = document.getElementById('limitInput').value.trim();

    if (from) body.from = from;
    if (to) body.to = to;
    if (limit) body.limit = parseInt(limit);

    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    scannedPages = data.pages;
    renderPages(data.pages);

    document.getElementById('pagesSection').classList.add('visible');
    document.getElementById('pagesCount').textContent = `${data.pages.length} halaman ditemukan di ${data.domain}`;
  } catch (err) {
    alert('Scan gagal: ' + err.message);
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan';
  }
}

// Render daftar halaman
function renderPages(pages) {
  const list = document.getElementById('pagesList');
  list.innerHTML = '';

  pages.forEach((page, i) => {
    const item = document.createElement('div');
    item.className = 'page-item';

    const ts = page.timestamp;
    const formattedDate = ts ? `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)}` : '';

    item.innerHTML = `
      <input type="checkbox" id="page_${i}" checked data-index="${i}">
      <span class="url">${page.original}</span>
      <span class="mimetype">${page.mimetype || ''}</span>
      <span class="timestamp">${formattedDate}</span>
    `;
    list.appendChild(item);
  });
}

function selectAll() {
  document.querySelectorAll('#pagesList input[type="checkbox"]').forEach(cb => cb.checked = true);
}

function deselectAll() {
  document.querySelectorAll('#pagesList input[type="checkbox"]').forEach(cb => cb.checked = false);
}

// Start download
async function startDownload() {
  const selected = [];
  document.querySelectorAll('#pagesList input[type="checkbox"]:checked').forEach(cb => {
    const idx = parseInt(cb.dataset.index);
    selected.push(scannedPages[idx]);
  });

  if (selected.length === 0) return alert('Pilih minimal 1 halaman');

  const downloadBtn = document.getElementById('downloadBtn');
  downloadBtn.disabled = true;

  // Show progress
  document.getElementById('progressSection').classList.add('visible');
  document.getElementById('progressErrors').innerHTML = '';

  // Connect SSE
  connectSSE();

  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages: selected })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
  } catch (err) {
    alert('Download gagal: ' + err.message);
    downloadBtn.disabled = false;
  }
}

// SSE Progress
function connectSSE() {
  if (eventSource) eventSource.close();

  eventSource = new EventSource('/api/progress');
  eventSource.onmessage = (e) => {
    const data = JSON.parse(e.data);
    updateProgress(data);
  };
  eventSource.onerror = () => {
    // Reconnect setelah 2 detik
    setTimeout(() => {
      if (eventSource) eventSource.close();
      connectSSE();
    }, 2000);
  };
}

function updateProgress(data) {
  const bar = document.getElementById('progressBar');
  const text = document.getElementById('progressText');
  const status = document.getElementById('progressStatus');
  const current = document.getElementById('progressCurrent');
  const errorsDiv = document.getElementById('progressErrors');

  const percent = data.total > 0 ? Math.round((data.done / data.total) * 100) : 0;
  bar.style.width = percent + '%';
  text.textContent = `${data.done} / ${data.total} (${percent}%)`;

  const statusMap = {
    'idle': 'Idle',
    'downloading': 'Downloading...',
    'rewriting': 'Rewriting links...',
    'done': 'Selesai!'
  };
  status.textContent = statusMap[data.status] || data.status;
  current.textContent = data.current || '';

  if (data.status === 'done') {
    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) downloadBtn.disabled = false;
    bar.style.background = '#00ff88';
    if (eventSource) { eventSource.close(); eventSource = null; }
    loadDownloads();
  }

  // Show errors
  if (data.errors && data.errors.length > 0) {
    errorsDiv.innerHTML = data.errors.map(e =>
      `<div class="error-item">${e.url}: ${e.error}</div>`
    ).join('');
  }
}

// Load daftar download
async function loadDownloads() {
  try {
    const res = await fetch('/api/downloads');
    const data = await res.json();

    const list = document.getElementById('downloadsList');
    if (data.sites.length === 0) {
      list.innerHTML = '<div class="empty-state">Belum ada download</div>';
      return;
    }

    list.innerHTML = data.sites.map(site => `
      <div class="download-item">
        <div>
          <span class="domain">${site.domain}</span>
          <span class="files-count">${site.files} files</span>
        </div>
        <div style="display:flex;gap:6px">
          <a href="${site.path}/index.html" target="_blank" class="btn btn-sm btn-primary">Buka</a>
          <a href="/api/zip/${site.domain}" class="btn btn-sm btn-download">ZIP</a>
        </div>
      </div>
    `).join('');
  } catch { /* skip */ }
}

// Enter key untuk scan
document.getElementById('urlInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (parsedWayback) {
      directDownload();
    } else {
      startScan();
    }
  }
});

// === Saat halaman dibuka ===

// Restore URL terakhir dari localStorage
const savedUrl = localStorage.getItem('lastUrl');
if (savedUrl) {
  document.getElementById('urlInput').value = savedUrl;
  document.getElementById('urlInput').dispatchEvent(new Event('input'));
}

// Simpan URL setiap kali berubah
document.getElementById('urlInput').addEventListener('change', (e) => {
  localStorage.setItem('lastUrl', e.target.value.trim());
});

// Load daftar download
loadDownloads();

// Auto-reconnect progress jika ada download yang masih jalan
(async function checkActiveDownload() {
  try {
    const es = new EventSource('/api/progress');
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.status === 'downloading' || data.status === 'rewriting') {
        document.getElementById('progressSection').classList.add('visible');
        updateProgress(data);
        // Ganti ke SSE permanen
        if (eventSource) eventSource.close();
        eventSource = es;
      } else if (data.status === 'done' && data.done > 0) {
        document.getElementById('progressSection').classList.add('visible');
        updateProgress(data);
        es.close();
      } else {
        es.close();
      }
    };
    es.onerror = () => es.close();
  } catch {}
})();
