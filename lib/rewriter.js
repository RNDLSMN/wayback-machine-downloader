const path = require('path');
const { URL } = require('url');
const { normalizeUrl, getDomain, urlToFilePath } = require('./utils');

function rewriteHtml(html, pageUrl, domain, downloadedPages) {
  // Hapus Wayback Machine toolbar/banner scripts
  html = html.replace(/<!--\s*BEGIN WAYBACK TOOLBAR INSERT\s*-->[\s\S]*?<!--\s*END WAYBACK TOOLBAR INSERT\s*-->/gi, '');
  html = html.replace(/<script[^>]*>[\s\S]*?wm\.wombat[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<script[^>]*_wm\.wombat[^>]*><\/script>/gi, '');
  html = html.replace(/<script[^>]*wombat\.js[^>]*><\/script>/gi, '');
  html = html.replace(/<script[^>]*>[\s\S]*?__wm\.\w+[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<link[^>]*wayback[^>]*>/gi, '');
  html = html.replace(/<!-- playback timridge[^>]*-->/gi, '');
  // Hapus div wayback toolbar
  html = html.replace(/<div\s+id="wm-ipp-base"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi, '');
  html = html.replace(/<div\s+id="wm-ipp"[\s\S]*?<\/div>/gi, '');

  // Hapus Wayback URL prefix dari semua attribute
  const waybackPattern = /https?:\/\/web\.archive\.org\/web\/\d{1,14}(?:id_|if_|js_|cs_|im_)?\//g;
  html = html.replace(waybackPattern, '');

  const pageFilePath = urlToFilePath(pageUrl, domain);
  const pageDir = path.dirname(pageFilePath);

  // Rewrite href, src, action, poster, data (semua attribute yang bisa berisi URL)
  html = html.replace(/(href|src|action|poster|data|content)=["']([^"']+)["']/gi, (match, attr, url) => {
    // Skip meta content yang bukan URL
    if (attr.toLowerCase() === 'content' && !url.match(/^https?:\/\//)) return match;
    const rewritten = rewriteUrl(url, pageUrl, domain, pageDir, downloadedPages);
    return `${attr}="${rewritten}"`;
  });

  // Rewrite xlink:href (SVG)
  html = html.replace(/xlink:href=["']([^"']+)["']/gi, (match, url) => {
    // SVG sprite: icons.svg#name -> rewrite icons.svg, keep #name
    const hashIdx = url.indexOf('#');
    if (hashIdx > 0) {
      const filePart = url.substring(0, hashIdx);
      const hashPart = url.substring(hashIdx);
      const rewritten = rewriteUrl(filePart, pageUrl, domain, pageDir, downloadedPages);
      return `xlink:href="${rewritten}${hashPart}"`;
    }
    if (url.startsWith('#')) return match;
    const rewritten = rewriteUrl(url, pageUrl, domain, pageDir, downloadedPages);
    return `xlink:href="${rewritten}"`;
  });

  // Rewrite srcset & data-srcset
  html = html.replace(/((?:data-)?srcset)=["']([^"']+)["']/gi, (match, attr, srcset) => {
    const rewritten = srcset.split(',').map(entry => {
      const parts = entry.trim().split(/\s+/);
      if (parts[0]) {
        parts[0] = rewriteUrl(parts[0], pageUrl, domain, pageDir, downloadedPages);
      }
      return parts.join(' ');
    }).join(', ');
    return `${attr}="${rewritten}"`;
  });

  // Rewrite data-src, data-bg, data-image, data-background, data-background-image
  html = html.replace(/(data-(?:src|bg|image|background|background-image))=["']([^"']+)["']/gi, (match, attr, url) => {
    const rewritten = rewriteUrl(url, pageUrl, domain, pageDir, downloadedPages);
    return `${attr}="${rewritten}"`;
  });

  // Rewrite inline CSS url()
  html = html.replace(/url\(["']?([^)"']+)["']?\)/g, (match, url) => {
    if (url.startsWith('data:') || url.startsWith('#')) return match;
    const rewritten = rewriteUrl(url, pageUrl, domain, pageDir, downloadedPages);
    return `url("${rewritten}")`;
  });

  return html;
}

function rewriteCss(css, cssUrl, domain) {
  const waybackPattern = /https?:\/\/web\.archive\.org\/web\/\d{1,14}(?:id_|if_|js_|cs_|im_)?\//g;
  css = css.replace(waybackPattern, '');

  const cssFilePath = urlToFilePath(cssUrl, domain);
  const cssDir = path.dirname(cssFilePath);

  // Rewrite url() di CSS
  css = css.replace(/url\(["']?([^)"']+)["']?\)/g, (match, url) => {
    if (url.startsWith('data:') || url.startsWith('#')) return match;
    const rewritten = rewriteUrl(url, cssUrl, domain, cssDir, new Set());
    return `url("${rewritten}")`;
  });

  // Rewrite @import
  css = css.replace(/@import\s+["']([^"']+)["']/g, (match, url) => {
    const rewritten = rewriteUrl(url, cssUrl, domain, cssDir, new Set());
    return `@import "${rewritten}"`;
  });

  return css;
}

function rewriteUrl(url, contextUrl, domain, contextDir, downloadedPages) {
  if (!url || url.startsWith('data:') || url.startsWith('#') || url.startsWith('javascript:') || url.startsWith('mailto:') || url.startsWith('tel:')) {
    return url;
  }

  // Hapus wayback prefix
  url = url.replace(/https?:\/\/web\.archive\.org\/web\/\d{1,14}(?:id_|if_|js_|cs_|im_)?\//g, '');

  let absoluteUrl;
  try {
    if (url.startsWith('//')) {
      absoluteUrl = 'http:' + url;
    } else if (url.startsWith('http://') || url.startsWith('https://')) {
      absoluteUrl = url;
    } else {
      absoluteUrl = new URL(url, normalizeUrl(contextUrl)).href;
    }
  } catch {
    return url;
  }

  const urlDomain = getDomain(absoluteUrl);
  if (urlDomain !== domain) {
    return absoluteUrl; // External, biarkan
  }

  const targetPath = urlToFilePath(absoluteUrl, domain);
  let relativePath = path.relative(contextDir, targetPath);

  relativePath = relativePath.split(path.sep).join('/');
  if (!relativePath.startsWith('.')) {
    relativePath = './' + relativePath;
  }

  return relativePath;
}

module.exports = {
  rewriteHtml,
  rewriteCss,
  rewriteUrl
};
