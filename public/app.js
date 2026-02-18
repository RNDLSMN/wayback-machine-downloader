let scannedPages = [];
let eventSource = null;
let parsedWayback = null;

// ========== TOAST NOTIFICATIONS ==========
function toast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);

  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ========== WAYBACK URL DETECTION ==========
document.getElementById('urlInput').addEventListener('input', async (e) => {
  const url = e.target.value.trim();
  const directBtn = document.getElementById('directBtn');

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
    } catch { }
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
    infoEl.className = 'wayback-info';
    document.querySelector('.input-section').appendChild(infoEl);
  }
  const ts = data.timestamp;
  const date = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)} ${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}`;
  infoEl.innerHTML = `
    <span class="label">Wayback URL terdeteksi!</span><br>
    URL Asli: <strong>${data.originalUrl}</strong><br>
    Timestamp: <strong>${date}</strong> · Domain: <strong>${data.domain}</strong>
    <span class="hint">Klik <b>Download Langsung</b> untuk download halaman ini + semua asset, atau <b>Scan</b> untuk cari semua halaman.</span>
  `;
  infoEl.style.display = 'block';
}

function hideWaybackInfo() {
  const infoEl = document.getElementById('waybackInfo');
  if (infoEl) infoEl.style.display = 'none';
}

// ========== DIRECT DOWNLOAD ==========
async function directDownload() {
  if (!parsedWayback) return toast('URL Wayback tidak valid', 'error');

  const directBtn = document.getElementById('directBtn');
  directBtn.disabled = true;
  directBtn.innerHTML = '<span class="spinner"></span>Downloading...';

  document.getElementById('progressSection').classList.add('visible');
  document.getElementById('progressErrors').innerHTML = '';
  document.getElementById('progressSection').scrollIntoView({ behavior: 'smooth', block: 'center' });
  connectSSE();
  document.getElementById('cancelBtn').style.display = 'inline-block';

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
    toast('Download dimulai!', 'success');
  } catch (err) {
    toast('Download gagal: ' + err.message, 'error');
  } finally {
    directBtn.disabled = false;
    directBtn.textContent = '⬇ Download Langsung';
  }
}

// ========== SCAN DOMAIN ==========
async function startScan() {
  const url = document.getElementById('urlInput').value.trim();
  if (!url) return toast('Masukkan URL terlebih dahulu', 'error');
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
    document.getElementById('pagesCount').textContent = `${data.pages.length.toLocaleString()} halaman di ${data.domain}`;
    document.getElementById('pageSearch').value = '';
    toast(`Ditemukan ${data.pages.length.toLocaleString()} halaman di ${data.domain}`, 'success');

    // Scroll to pages
    setTimeout(() => {
      document.getElementById('pagesSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  } catch (err) {
    toast('Scan gagal: ' + err.message, 'error');
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = '🔍 Scan';
  }
}

// ========== RENDER PAGES ==========
function renderPages(pages) {
  const list = document.getElementById('pagesList');
  list.innerHTML = '';

  pages.forEach((page, i) => {
    const item = document.createElement('div');
    item.className = 'page-item';
    item.dataset.url = (page.original || '').toLowerCase();

    const ts = page.timestamp;
    const formattedDate = ts ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}` : '';

    item.innerHTML = `
      <input type="checkbox" id="page_${i}" checked data-index="${i}" onchange="updateStats()">
      <span class="url">${page.original}</span>
      <span class="mimetype">${page.mimetype || ''}</span>
      <span class="timestamp">${formattedDate}</span>
    `;
    list.appendChild(item);
  });

  updateStats();
}

// ========== SEARCH / FILTER PAGES ==========
function filterPages() {
  const query = document.getElementById('pageSearch').value.toLowerCase().trim();
  const items = document.querySelectorAll('#pagesList .page-item');

  items.forEach(item => {
    const url = item.dataset.url || '';
    if (!query || url.includes(query)) {
      item.classList.remove('hidden');
    } else {
      item.classList.add('hidden');
    }
  });

  updateStats();
}

// ========== STATS ==========
function updateStats() {
  const all = document.querySelectorAll('#pagesList .page-item');
  const visible = document.querySelectorAll('#pagesList .page-item:not(.hidden)');
  const checked = document.querySelectorAll('#pagesList input[type="checkbox"]:checked');

  document.getElementById('statTotal').textContent = all.length.toLocaleString();
  document.getElementById('statSelected').textContent = checked.length.toLocaleString();
  document.getElementById('statVisible').textContent = visible.length.toLocaleString();
}

function selectAll() {
  document.querySelectorAll('#pagesList .page-item:not(.hidden) input[type="checkbox"]').forEach(cb => cb.checked = true);
  updateStats();
  toast('Semua halaman dipilih', 'info');
}

function deselectAll() {
  document.querySelectorAll('#pagesList input[type="checkbox"]').forEach(cb => cb.checked = false);
  updateStats();
  toast('Semua pilihan dihapus', 'info');
}

// ========== START DOWNLOAD ==========
async function startDownload() {
  const selected = [];
  document.querySelectorAll('#pagesList input[type="checkbox"]:checked').forEach(cb => {
    const idx = parseInt(cb.dataset.index);
    selected.push(scannedPages[idx]);
  });

  if (selected.length === 0) return toast('Pilih minimal 1 halaman', 'error');

  const downloadBtn = document.getElementById('downloadBtn');
  downloadBtn.disabled = true;

  // Show progress
  document.getElementById('progressSection').classList.add('visible');
  document.getElementById('progressErrors').innerHTML = '';
  document.getElementById('progressBar').classList.remove('done');

  // Smooth scroll
  setTimeout(() => {
    document.getElementById('progressSection').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);

  connectSSE();
  document.getElementById('cancelBtn').style.display = 'inline-block';

  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages: selected })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    toast(`Download ${selected.length.toLocaleString()} halaman dimulai!`, 'success');
  } catch (err) {
    toast('Download gagal: ' + err.message, 'error');
    downloadBtn.disabled = false;
  }
}

// ========== SSE PROGRESS ==========
function connectSSE() {
  if (eventSource) eventSource.close();

  eventSource = new EventSource('/api/progress');
  eventSource.onmessage = (e) => {
    const data = JSON.parse(e.data);
    updateProgress(data);
  };
  eventSource.onerror = () => {
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
  text.textContent = `${data.done.toLocaleString()} / ${data.total.toLocaleString()} (${percent}%)`;

  const statusMap = {
    'idle': '⏸ Idle',
    'downloading': '⬇️ Downloading...',
    'rewriting': '🔄 Rewriting links...',
    'done': '✅ Selesai!'
  };
  status.textContent = statusMap[data.status] || data.status;
  current.textContent = data.current || '';

  if (data.status === 'done') {
    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) downloadBtn.disabled = false;
    bar.classList.add('done');
    document.getElementById('cancelBtn').style.display = 'none';
    if (eventSource) { eventSource.close(); eventSource = null; }
    loadDownloads();
    toast('Download selesai! 🎉', 'success');
  }

  if (data.status === 'cancelled') {
    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) downloadBtn.disabled = false;
    bar.style.background = '#ef4444';
    bar.classList.add('done');
    document.getElementById('cancelBtn').style.display = 'none';
    if (eventSource) { eventSource.close(); eventSource = null; }
    loadDownloads();
    toast('Download dibatalkan', 'info');
  }

  // Show errors
  if (data.errors && data.errors.length > 0) {
    errorsDiv.innerHTML = data.errors.map(e =>
      `<div class="error-item">❌ ${e.url}: ${e.error}</div>`
    ).join('');
  }
}

// ========== CANCEL DOWNLOAD ==========
async function cancelDownload() {
  try {
    const res = await fetch('/api/cancel', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
  } catch (err) {
    toast('Gagal membatalkan: ' + err.message, 'error');
  }
}

// ========== LOAD DOWNLOADS ==========
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
      <div class="download-item" id="dl-${site.domain.replace(/\./g, '-')}">
        <div>
          <span class="domain">${site.domain}</span>
          <span class="files-count">${site.files.toLocaleString()} files</span>
        </div>
        <div class="download-actions">
          <a href="${site.path}/index.html" target="_blank" class="btn btn-sm btn-primary">🔗 Buka</a>
          <a href="/api/zip/${site.domain}" class="btn btn-sm btn-download">📦 ZIP</a>
          <button class="btn btn-sm btn-danger btn-icon" onclick="deleteSite('${site.domain}')" title="Hapus">🗑</button>
        </div>
      </div>
    `).join('');
  } catch { /* skip */ }
}

// ========== DELETE SITE ==========
async function deleteSite(domain) {
  if (!confirm(`Hapus semua file untuk ${domain}?`)) return;

  try {
    const res = await fetch(`/api/downloads/${encodeURIComponent(domain)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Animate removal
    const el = document.getElementById(`dl-${domain.replace(/\./g, '-')}`);
    if (el) {
      el.style.transition = 'all 0.3s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      setTimeout(() => el.remove(), 300);
    }

    toast(`${domain} dihapus`, 'success');

    // Reload if empty
    setTimeout(() => {
      const remaining = document.querySelectorAll('.download-item');
      if (remaining.length === 0) {
        document.getElementById('downloadsList').innerHTML = '<div class="empty-state">Belum ada download</div>';
      }
    }, 350);
  } catch (err) {
    toast('Gagal menghapus: ' + err.message, 'error');
  }
}

// ========== KEYBOARD SHORTCUTS ==========
document.getElementById('urlInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (parsedWayback) {
      directDownload();
    } else {
      startScan();
    }
  }
});

// Ctrl/Cmd+A inside pages list -> select all visible
document.getElementById('pagesList')?.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
    e.preventDefault();
    selectAll();
  }
});

// ========== INIT ==========

// Restore last URL
const savedUrl = localStorage.getItem('lastUrl');
if (savedUrl) {
  document.getElementById('urlInput').value = savedUrl;
  document.getElementById('urlInput').dispatchEvent(new Event('input'));
}

// Save URL on change
document.getElementById('urlInput').addEventListener('change', (e) => {
  localStorage.setItem('lastUrl', e.target.value.trim());
});

// Load downloads list
loadDownloads();

// Auto-reconnect if download is active
(async function checkActiveDownload() {
  try {
    const es = new EventSource('/api/progress');
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.status === 'downloading' || data.status === 'rewriting') {
        document.getElementById('progressSection').classList.add('visible');
        updateProgress(data);
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
  } catch { }
})();
