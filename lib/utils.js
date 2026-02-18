const path = require('path');
const { URL } = require('url');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeUrl(url) {
  url = url.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'http://' + url;
  }
  return url;
}

function getDomain(url) {
  try {
    const parsed = new URL(normalizeUrl(url));
    return parsed.hostname;
  } catch {
    return url.replace(/https?:\/\//, '').split('/')[0];
  }
}

function urlToFilePath(urlStr, baseDomain) {
  try {
    const parsed = new URL(normalizeUrl(urlStr));
    let pathname = parsed.pathname;

    if (pathname === '/' || pathname === '') {
      pathname = '/index.html';
    } else if (!path.extname(pathname)) {
      pathname = pathname.replace(/\/$/, '') + '/index.html';
    }

    pathname = decodeURIComponent(pathname);
    pathname = pathname.replace(/[<>:"|?*]/g, '_');

    return path.join(baseDomain, pathname);
  } catch {
    return path.join(baseDomain, 'index.html');
  }
}

function isAssetUrl(url) {
  const ext = path.extname(url).toLowerCase().split('?')[0];
  const assetExts = [
    '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
    '.woff', '.woff2', '.ttf', '.eot', '.otf', '.webp', '.avif',
    '.mp4', '.webm', '.mp3', '.pdf'
  ];
  return assetExts.includes(ext);
}

function isPageUrl(url) {
  const ext = path.extname(url).toLowerCase().split('?')[0];
  if (!ext || ext === '.html' || ext === '.htm' || ext === '.php' || ext === '.asp' || ext === '.aspx' || ext === '.jsp') {
    return true;
  }
  return false;
}

function resolveUrl(baseUrl, relativeUrl) {
  try {
    if (relativeUrl.startsWith('//')) {
      return 'http:' + relativeUrl;
    }
    return new URL(relativeUrl, normalizeUrl(baseUrl)).href;
  } catch {
    return relativeUrl;
  }
}

async function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (WaybackHTMLMachine/1.0)'
        },
        redirect: 'follow'
      });

      if (response.status === 429) {
        const waitTime = Math.pow(2, i + 1) * 1000;
        await delay(waitTime);
        continue;
      }

      return response;
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await delay(1000 * (i + 1));
    }
  }
  throw new Error(`Failed after ${maxRetries} retries: ${url}`);
}

function parseWaybackUrl(url) {
  const match = url.match(/^https?:\/\/web\.archive\.org\/web\/(\d{1,14})(?:id_|if_|js_|cs_|im_)?\/(https?:\/\/.+)$/);
  if (!match) return null;
  return { timestamp: match[1], originalUrl: match[2] };
}

module.exports = {
  delay,
  normalizeUrl,
  getDomain,
  urlToFilePath,
  isAssetUrl,
  isPageUrl,
  resolveUrl,
  fetchWithRetry,
  parseWaybackUrl
};
