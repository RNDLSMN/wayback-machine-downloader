const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { getWaybackUrl, getSnapshot } = require('./cdx');
const { rewriteHtml, rewriteCss } = require('./rewriter');
const { delay, normalizeUrl, getDomain, urlToFilePath, resolveUrl } = require('./utils');

const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');
const REQUEST_DELAY = 200;
const FETCH_TIMEOUT = 30000;

class Downloader {
  constructor() {
    this.progress = { total: 0, done: 0, current: '', status: 'idle', errors: [] };
    this.listeners = [];
    this.downloadedAssets = new Set();
    this.downloadedPages = new Set();
    this.cancelled = false;
  }

  onProgress(callback) { this.listeners.push(callback); }
  emit() { for (const cb of this.listeners) cb({ ...this.progress }); }
  updateProgress(fields) { Object.assign(this.progress, fields); this.emit(); }

  cancel() {
    this.cancelled = true;
    this.updateProgress({ current: 'Dibatalkan!', status: 'cancelled' });
  }

  async downloadSite(pages, preferredTimestamp) {
    if (!pages || pages.length === 0) return;

    const domain = getDomain(pages[0].original || pages[0].url);
    const outputDir = path.join(DOWNLOADS_DIR, domain);

    this.downloadedAssets.clear();
    this.downloadedPages.clear();
    this.progress = { total: pages.length, done: 0, current: '', status: 'downloading', errors: [] };
    this.emit();

    for (const page of pages) {
      if (this.cancelled) break;

      const url = page.original || page.url;
      const timestamp = page.timestamp || preferredTimestamp;

      this.updateProgress({ current: `Halaman: ${url}` });

      try {
        await this.downloadPage(url, timestamp, domain, outputDir);
      } catch (err) {
        this.progress.errors.push({ url, error: err.message });
      }

      this.progress.done++;
      this.emit();
      await delay(REQUEST_DELAY);
    }

    if (this.cancelled) {
      return { outputDir, domain };
    }

    this.updateProgress({ current: 'Rewriting links...', status: 'rewriting' });
    await this.rewriteAllPages(outputDir, domain);

    this.updateProgress({ current: 'Selesai!', status: 'done', outputDir });
    return { outputDir, domain };
  }

  async downloadPage(url, timestamp, domain, outputDir) {
    const normalizedUrl = normalizeUrl(url);
    if (this.downloadedPages.has(normalizedUrl)) return;
    this.downloadedPages.add(normalizedUrl);

    let snap = timestamp
      ? { timestamp, original: normalizedUrl }
      : await getSnapshot(normalizedUrl);
    if (!snap) throw new Error(`No snapshot for ${url}`);

    const waybackUrl = getWaybackUrl(snap.timestamp, normalizedUrl, true);
    const response = await this.fetchWithTimeout(waybackUrl);
    if (!response || !response.ok) throw new Error(`HTTP ${response?.status || 'timeout'}`);

    const contentType = response.headers.get('content-type') || '';
    const html = await response.text();

    const filePath = urlToFilePath(normalizedUrl, domain);
    const fullPath = path.join(outputDir, filePath.replace(domain + '/', ''));
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, html, 'utf8');

    if (contentType.includes('text/html') || html.trim().startsWith('<!') || html.trim().startsWith('<html')) {
      await this.extractAndDownloadAssets(html, normalizedUrl, snap.timestamp, domain, outputDir);
    }
  }

  async fetchWithTimeout(url, retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
      if (this.cancelled) return null;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (WaybackHTMLMachine/1.0)' },
          redirect: 'follow',
          signal: controller.signal
        });

        // Rate limited — wait and retry
        if (response.status === 429) {
          clearTimeout(timer);
          const waitTime = Math.pow(2, attempt + 1) * 2000;
          this.updateProgress({ current: `Rate limited, tunggu ${waitTime / 1000}s...` });
          await delay(waitTime);
          continue;
        }

        // Server error — retry
        if (response.status >= 500 && attempt < retries - 1) {
          clearTimeout(timer);
          this.updateProgress({ current: `Server error ${response.status}, retry ${attempt + 1}...` });
          await delay((attempt + 1) * 2000);
          continue;
        }

        return response;
      } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          if (attempt < retries - 1) {
            this.updateProgress({ current: `Timeout, retry ${attempt + 1}...` });
            await delay(1000 * (attempt + 1));
            continue;
          }
          return null;
        }
        if (attempt < retries - 1) {
          await delay(1000 * (attempt + 1));
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  // =============================================
  // EXTRACT SEMUA JENIS ASSET DARI HTML
  // =============================================
  async extractAndDownloadAssets(html, pageUrl, timestamp, domain, outputDir) {
    const $ = cheerio.load(html);
    const assets = new Set();

    const addUrl = (url) => {
      if (!url) return;
      const cleaned = this.cleanWaybackUrl(url, pageUrl);
      if (cleaned && !cleaned.startsWith('data:') && !cleaned.startsWith('#') &&
        !cleaned.startsWith('javascript:') && !cleaned.startsWith('mailto:')) {
        assets.add(cleaned);
      }
    };

    // --- SEMUA <link> tags ---
    // stylesheet, icon, favicon, apple-touch-icon, manifest, preload, prefetch
    $('link[href]').each((_, el) => {
      const href = $(el).attr('href');
      const rel = ($(el).attr('rel') || '').toLowerCase();
      // Skip canonical, alternate, dns-prefetch (bukan asset)
      if (['canonical', 'alternate', 'dns-prefetch', 'preconnect', 'next', 'prev'].includes(rel)) return;
      addUrl(href);
    });

    // --- <script src> ---
    $('script[src]').each((_, el) => addUrl($(el).attr('src')));

    // --- <img> src + srcset ---
    $('img[src]').each((_, el) => addUrl($(el).attr('src')));

    // --- <picture> <source> ---
    $('picture source[srcset]').each((_, el) => {
      ($(el).attr('srcset') || '').split(',').forEach(e => {
        const url = e.trim().split(/\s+/)[0];
        if (url) addUrl(url);
      });
    });
    $('picture source[src]').each((_, el) => addUrl($(el).attr('src')));

    // --- <video> poster + src + <source> ---
    $('video[poster]').each((_, el) => addUrl($(el).attr('poster')));
    $('video[src]').each((_, el) => addUrl($(el).attr('src')));
    $('video source[src]').each((_, el) => addUrl($(el).attr('src')));

    // --- <audio> src + <source> ---
    $('audio[src]').each((_, el) => addUrl($(el).attr('src')));
    $('audio source[src]').each((_, el) => addUrl($(el).attr('src')));

    // --- <object> data ---
    $('object[data]').each((_, el) => addUrl($(el).attr('data')));

    // --- <embed> src ---
    $('embed[src]').each((_, el) => addUrl($(el).attr('src')));

    // --- <use> xlink:href & href (SVG icons) ---
    $('use').each((_, el) => {
      let href = $(el).attr('xlink:href') || $(el).attr('href') || '';
      // SVG sprite: /icons.svg#icon-name -> download icons.svg
      if (href.includes('#')) href = href.split('#')[0];
      if (href) addUrl(href);
    });

    // --- <svg> <image> ---
    $('svg image').each((_, el) => {
      addUrl($(el).attr('xlink:href') || $(el).attr('href'));
    });

    // --- <meta> og:image, twitter:image ---
    $('meta[property="og:image"], meta[name="twitter:image"]').each((_, el) => {
      addUrl($(el).attr('content'));
    });

    // --- <input> type=image ---
    $('input[type="image"][src]').each((_, el) => addUrl($(el).attr('src')));

    // --- Semua srcset attributes (img, source, dll) ---
    $('[srcset]').each((_, el) => {
      ($(el).attr('srcset') || '').split(',').forEach(entry => {
        const url = entry.trim().split(/\s+/)[0];
        if (url) addUrl(url);
      });
    });

    // --- data-src, data-bg, data-image (lazy loading) ---
    $('[data-src]').each((_, el) => addUrl($(el).attr('data-src')));
    $('[data-bg]').each((_, el) => addUrl($(el).attr('data-bg')));
    $('[data-image]').each((_, el) => addUrl($(el).attr('data-image')));
    $('[data-srcset]').each((_, el) => {
      ($(el).attr('data-srcset') || '').split(',').forEach(entry => {
        const url = entry.trim().split(/\s+/)[0];
        if (url) addUrl(url);
      });
    });
    $('[data-background]').each((_, el) => addUrl($(el).attr('data-background')));
    $('[data-background-image]').each((_, el) => addUrl($(el).attr('data-background-image')));

    // --- Inline style url() ---
    $('[style]').each((_, el) => {
      const style = $(el).attr('style') || '';
      const matches = style.match(/url\(["']?([^)"']+)["']?\)/g);
      if (matches) {
        matches.forEach(m => {
          const url = m.replace(/url\(["']?/, '').replace(/["']?\)/, '');
          addUrl(url);
        });
      }
    });

    // --- <style> blocks inline di HTML ---
    $('style').each((_, el) => {
      const css = $(el).html() || '';
      this.extractUrlsFromCss(css, pageUrl).forEach(u => addUrl(u));
    });

    // Filter: hanya asset dari domain yang sama
    const newAssets = [...assets].filter(a => {
      try { return getDomain(a) === domain && !this.downloadedAssets.has(a); }
      catch { return false; }
    });

    this.progress.total += newAssets.length;
    this.emit();

    for (const assetUrl of newAssets) {
      if (this.cancelled) break;

      this.downloadedAssets.add(assetUrl);
      let name;
      try { name = decodeURIComponent(path.basename(assetUrl)).substring(0, 60); }
      catch { name = assetUrl.substring(assetUrl.length - 50); }
      this.updateProgress({ current: `Asset: ${name}` });

      try {
        await this.downloadAsset(assetUrl, timestamp, domain, outputDir);
      } catch (err) {
        this.progress.errors.push({ url: assetUrl, error: err.message });
      }

      this.progress.done++;
      this.emit();
      await delay(REQUEST_DELAY);
    }
  }

  // Extract url() dari CSS text
  extractUrlsFromCss(css, contextUrl) {
    const urls = [];
    // url()
    const urlRegex = /url\(["']?([^)"']+)["']?\)/g;
    let match;
    while ((match = urlRegex.exec(css)) !== null) {
      if (!match[1].startsWith('data:')) {
        urls.push(this.cleanWaybackUrl(match[1], contextUrl));
      }
    }
    // @import "..."
    const importRegex = /@import\s+["']([^"']+)["']/g;
    while ((match = importRegex.exec(css)) !== null) {
      urls.push(this.cleanWaybackUrl(match[1], contextUrl));
    }
    return urls;
  }

  cleanWaybackUrl(url, contextUrl) {
    if (!url) return url;
    url = url.replace(/https?:\/\/web\.archive\.org\/web\/\d{1,14}(?:id_|if_|js_|cs_|im_)?\//g, '');

    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('//')) {
      url = resolveUrl(contextUrl, url);
    } else if (url.startsWith('//')) {
      url = 'http:' + url;
    }
    return url;
  }

  async downloadAsset(assetUrl, timestamp, domain, outputDir) {
    const normalized = normalizeUrl(assetUrl);

    const waybackUrl = getWaybackUrl(timestamp, normalized, true);
    const response = await this.fetchWithTimeout(waybackUrl);

    if (!response || !response.ok) return;

    const contentType = response.headers.get('content-type') || '';
    const filePath = urlToFilePath(normalized, domain);
    const fullPath = path.join(outputDir, filePath.replace(domain + '/', ''));

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    if (contentType.includes('text/css')) {
      const css = await response.text();
      fs.writeFileSync(fullPath, css, 'utf8');

      // Download sub-assets dari CSS (fonts, background images, @import)
      const cssUrls = this.extractUrlsFromCss(css, normalized);
      const newCssAssets = cssUrls.filter(u => {
        try { return u && !this.downloadedAssets.has(u) && getDomain(u) === domain; }
        catch { return false; }
      });

      this.progress.total += newCssAssets.length;
      this.emit();

      for (const cssAssetUrl of newCssAssets) {
        if (this.cancelled) break;

        this.downloadedAssets.add(cssAssetUrl);
        let name;
        try { name = path.basename(cssAssetUrl).substring(0, 50); }
        catch { name = 'asset'; }
        this.updateProgress({ current: `CSS Asset: ${name}` });
        try {
          await this.downloadAsset(cssAssetUrl, timestamp, domain, outputDir);
        } catch { /* skip */ }
        this.progress.done++;
        this.emit();
        await delay(REQUEST_DELAY);
      }
    } else if (contentType.includes('image/svg') || normalized.endsWith('.svg')) {
      // SVG bisa berisi referensi ke asset lain
      const svg = await response.text();
      fs.writeFileSync(fullPath, svg, 'utf8');
    } else {
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(fullPath, buffer);
    }
  }

  async rewriteAllPages(outputDir, domain) {
    for (const htmlFile of this.findFilesByExt(outputDir, '.html')) {
      try {
        let html = fs.readFileSync(htmlFile, 'utf8');
        const relativePath = path.relative(outputDir, htmlFile);
        const pageUrl = 'http://' + domain + '/' + relativePath.replace(/index\.html$/, '').replace(/\\/g, '/');
        html = rewriteHtml(html, pageUrl, domain, this.downloadedPages);
        fs.writeFileSync(htmlFile, html, 'utf8');
      } catch { /* skip */ }
    }

    for (const cssFile of this.findFilesByExt(outputDir, '.css')) {
      try {
        let css = fs.readFileSync(cssFile, 'utf8');
        const relativePath = path.relative(outputDir, cssFile);
        const cssUrl = 'http://' + domain + '/' + relativePath.replace(/\\/g, '/');
        css = rewriteCss(css, cssUrl, domain);
        fs.writeFileSync(cssFile, css, 'utf8');
      } catch { /* skip */ }
    }
  }

  findFilesByExt(dir, ext) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...this.findFilesByExt(fullPath, ext));
      else if (entry.name.endsWith(ext)) results.push(fullPath);
    }
    return results;
  }
}

module.exports = Downloader;
