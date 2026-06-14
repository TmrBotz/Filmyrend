const express = require("express");
const cheerio = require("cheerio");
const https = require("https");
const http = require("http");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE = "https://filmyfly.builders";

// ─── HELPERS ────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clean(str) {
  if (!str) return null;
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Cookie store
const cookieStore = {};

function saveCookies(domain, setCookieHeader) {
  if (!setCookieHeader) return;
  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : [setCookieHeader];
  if (!cookieStore[domain]) cookieStore[domain] = {};
  cookies.forEach((c) => {
    const [kv] = c.split(";");
    const [k, v] = kv.split("=");
    if (k && v) cookieStore[domain][k.trim()] = v.trim();
  });
}

function getCookies(domain) {
  if (!cookieStore[domain]) return "";
  return Object.entries(cookieStore[domain])
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function getHtml(url, referer = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const domain = parsed.hostname;
    const cookies = getCookies(domain);

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "identity",
      "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": referer ? "cross-site" : "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      "Connection": "keep-alive",
    };

    if (referer) headers["Referer"] = referer;
    if (cookies) headers["Cookie"] = cookies;

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers,
      timeout: 15000,
    };

    const lib = parsed.protocol === "https:" ? https : http;

    const req = lib.request(options, (res) => {
      // Save cookies
      saveCookies(domain, res.headers["set-cookie"]);

      // Handle redirect
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const location = res.headers["location"];
        if (location) {
          const redirectUrl = location.startsWith("http")
            ? location
            : `${parsed.protocol}//${parsed.hostname}${location}`;
          return resolve(getHtml(redirectUrl, referer));
        }
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} → ${url}`));
      }

      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timeout → ${url}`));
    });

    req.end();
  });
}

// ─── PARSERS ────────────────────────────────────────────────────────────
function parseHome(html, limit = 5) {
  const $ = cheerio.load(html);
  const items = [];
  $(".A10").each((_, el) => {
    if (items.length >= limit) return false;
    const a = $(el).find("td:nth-child(2) a").first();
    const img = $(el).find("img").first();
    const href = a.attr("href") || "";
    const match = href.match(/\/page-download\/(\d+)\/([^"]+)\.html/);
    if (!match) return;
    const categoryEl = $(el).find("div[style*='border-radius: 10px']");
    items.push({
      path: href,
      id: match[1],
      slug: match[2],
      thumbnail: img.attr("src") || null,
      title: clean(a.find("div").text()),
      category: clean(categoryEl.text()),
    });
  });
  return items;
}

function parseDetail(html) {
  const $ = cheerio.load(html);
  const field = (label) => {
    let val = null;
    $(".fname").each((_, e) => {
      const text = $(e).clone().children().remove().end().text().trim();
      if (text.startsWith(label)) {
        val = clean($(e).find("[class^='color']").text());
        return false;
      }
    });
    return val;
  };
  const dlLink = $("a.dl").attr("href") || null;
  const linkmakeMatch = dlLink?.match(/linkmake\.in\/view\/([A-Za-z0-9]+)/);
  return {
    image: $(".movie-thumb img").attr("src") || null,
    name: field("Name"),
    genre: field("Genre"),
    duration: field("Duration"),
    language: field("Language"),
    starcast: field("Starcast"),
    size: field("Size"),
    description: field("Description"),
    linkmakeUrl: dlLink,
    linkmakeCode: linkmakeMatch ? linkmakeMatch[1] : null,
  };
}

function parseLinkmake(html) {
  const $ = cheerio.load(html);
  const links = [];
  $(".dlink.dl a").each((_, el) => {
    const url = $(el).attr("href") || "";
    const label = clean($(el).find(".dll").text());
    const match = url.match(/new\d+\.filesdl\.in\/(cloud|drive)\/([A-Za-z0-9]+)/);
    if (!match) return;
    links.push({ label, type: match[1], code: match[2], filesdlUrl: url });
  });
  return links;
}

function parseFilesdl(html) {
  const $ = cheerio.load(html);
  const fileName = clean($(".title").first().text());
  const size = clean(
    $(".info")
      .filter((_, e) => $(e).text().startsWith("Size:"))
      .first()
      .text()
      .replace("Size:", "")
  );
  const links = [];
  $("a[class^='button']").each((_, el) => {
    const url = $(el).attr("href") || "";
    const cls = $(el).attr("class") || "";
    let label = clean($(el).text());
    if (!label || label.length < 2) return;
    let finalUrl = url;
    if (cls.includes("download-link")) {
      finalUrl += "&token=" + Math.floor(1000000000 + Math.random() * 9000000000);
    }
    links.push({ label, url: finalUrl });
  });
  return { fileName, size, links };
}

// ─── SCRAPER ────────────────────────────────────────────────────────────
async function scrapeMovie(entry) {
  try {
    const detailHtml = await getHtml(BASE + entry.path, BASE + "/");
    const detail = parseDetail(detailHtml);

    if (!detail.linkmakeUrl) {
      return {
        title: entry.title,
        thumbnail: entry.thumbnail,
        category: entry.category,
        error: "linkmake URL not found",
      };
    }

    await sleep(500);

    const linkmakeHtml = await getHtml(
      detail.linkmakeUrl,
      BASE + entry.path
    );
    const qualityLinks = parseLinkmake(linkmakeHtml);

    if (qualityLinks.length === 0) {
      return {
        title: detail.name || entry.title,
        thumbnail: detail.image || entry.thumbnail,
        category: entry.category,
        error: "no filesdl links found",
      };
    }

    await sleep(300);

    const downloadLinks = await Promise.all(
      qualityLinks.map(async (q) => {
        try {
          await sleep(150);
          const html = await getHtml(q.filesdlUrl, detail.linkmakeUrl);
          const parsed = parseFilesdl(html);
          return {
            quality: q.label,
            fileName: parsed.fileName,
            size: parsed.size,
            servers: parsed.links,
          };
        } catch (e) {
          return { quality: q.label, error: e.message };
        }
      })
    );

    return {
      title: detail.name || entry.title,
      thumbnail: detail.image || entry.thumbnail,
      category: entry.category,
      info: {
        genre: detail.genre,
        duration: detail.duration,
        language: detail.language,
        starcast: detail.starcast,
        size: detail.size,
        description: detail.description,
      },
      download_links: downloadLinks,
      source: BASE + entry.path,
    };
  } catch (e) {
    return { title: entry.title, category: entry.category, error: e.message };
  }
}

async function scrapeTopMovies(limit = 5) {
  const homeHtml = await getHtml(BASE + "/");
  const movies = parseHome(homeHtml, limit);
  if (movies.length === 0) throw new Error("Home page parse failed");
  const posts = await Promise.all(movies.map(scrapeMovie));
  return {
    success: true,
    scraped_at: new Date().toISOString(),
    count: posts.length,
    posts,
  };
}

// ─── CACHE ──────────────────────────────────────────────────────────────
let cache = { data: null, ts: 0 };
const CACHE_TTL = 10 * 60 * 1000;

// ─── ROUTES ─────────────────────────────────────────────────────────────
app.get("/", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 5, 10);
    const now = Date.now();
    if (cache.data && now - cache.ts < CACHE_TTL) {
      return res.json({ ...cache.data, cached: true });
    }
    const data = await scrapeTopMovies(limit);
    cache = { data, ts: now };
    res.json(data);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/refresh", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 5, 10);
    const data = await scrapeTopMovies(limit);
    cache = { data, ts: Date.now() };
    res.json(data);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/health", (_, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.listen(PORT, () => console.log(`Running on port ${PORT}`));
