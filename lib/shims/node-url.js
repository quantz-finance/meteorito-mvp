const { URL, URLSearchParams } = require('react-native-url-polyfill');

function parse(urlStr) {
  try {
    const u = new URL(urlStr);
    const search = u.search || '';
    return {
      protocol: u.protocol,
      slashes: true,
      auth: u.username ? u.username + (u.password ? ':' + u.password : '') : null,
      host: u.host,
      port: u.port,
      hostname: u.hostname,
      hash: u.hash || null,
      search: search || null,
      query: search.startsWith('?') ? search.slice(1) : search,
      pathname: u.pathname,
      path: u.pathname + search,
      href: u.href,
    };
  } catch {
    return { href: String(urlStr), pathname: String(urlStr) };
  }
}

module.exports = { parse, URL, URLSearchParams, format: (u) => (u && u.href) || String(u) };
