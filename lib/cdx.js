const { fetchWithRetry, normalizeUrl, getDomain } = require('./utils');

const CDX_API = 'https://web.archive.org/cdx/search/cdx';

async function scanDomain(url, options = {}) {
  const domain = getDomain(url);
  const params = new URLSearchParams({
    url: `${domain}/*`,
    output: 'json',
    filter: 'statuscode:200',
    collapse: 'urlkey',
    fl: 'timestamp,original,mimetype,statuscode,length',
    limit: options.limit || '500'
  });

  if (options.from) params.set('from', options.from);
  if (options.to) params.set('to', options.to);

  const response = await fetchWithRetry(`${CDX_API}?${params}`);
  if (!response.ok) {
    throw new Error(`CDX API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!data || data.length < 2) return [];

  const headers = data[0];
  const rows = data.slice(1);

  return rows.map(row => {
    const entry = {};
    headers.forEach((h, i) => { entry[h] = row[i]; });
    return entry;
  });
}

async function getSnapshot(url) {
  const normalized = normalizeUrl(url);
  const params = new URLSearchParams({
    url: normalized,
    output: 'json',
    filter: 'statuscode:200',
    limit: '-1',
    fl: 'timestamp,original'
  });

  const response = await fetchWithRetry(`${CDX_API}?${params}`);
  if (!response.ok) return null;

  const data = await response.json();
  if (!data || data.length < 2) return null;

  const last = data[data.length - 1];
  return { timestamp: last[0], original: last[1] };
}

function getWaybackUrl(timestamp, originalUrl, raw = true) {
  const flag = raw ? 'id_' : 'if_';
  return `https://web.archive.org/web/${timestamp}${flag}/${originalUrl}`;
}

async function findClosestSnapshot(url, timestamp) {
  const normalized = normalizeUrl(url);
  const params = new URLSearchParams({
    url: normalized,
    output: 'json',
    filter: 'statuscode:200',
    limit: '1',
    fl: 'timestamp,original'
  });

  if (timestamp) {
    params.set('from', timestamp);
    params.set('to', timestamp);
  }

  const response = await fetchWithRetry(`${CDX_API}?${params}`);
  if (!response.ok) return null;

  const data = await response.json();
  if (!data || data.length < 2) return null;

  return { timestamp: data[1][0], original: data[1][1] };
}

module.exports = {
  scanDomain,
  getSnapshot,
  getWaybackUrl,
  findClosestSnapshot
};
