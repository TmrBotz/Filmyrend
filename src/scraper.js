const fetch = require("node-fetch");
const {
  parseHome,
  parseDetail,
  parseLinkmake,
  parseFilesdl,
} = require("./parsers");

const BASE = "https://filmyfly.builders";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getHtml(url, referer = null) {
  const headers = { ...HEADERS };
  if (referer) headers["Referer"] = referer;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} → ${url}`);
  return res.text();
}

async function scrapeFilesdlPage(q, linkmakeUrl) {
  try {
    const html = await getHtml(q.filesdlUrl, linkmakeUrl);
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
}

async function scrapeMovie(entry) {
  try {
    // Step 1: Detail page
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

    await sleep(200);

    // Step 2: Linkmake page
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

    await sleep(200);

    // Step 3: All quality pages — parallel (no limit on Render!)
    const downloadLinks = await Promise.all(
      qualityLinks.map((q) => scrapeFilesdlPage(q, detail.linkmakeUrl))
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
    return {
      title: entry.title,
      category: entry.category,
      error: e.message,
    };
  }
}

async function scrapeTopMovies(limit = 5) {
  // Home page
  const homeHtml = await getHtml(BASE + "/");
  const movies = parseHome(homeHtml, limit);

  if (movies.length === 0) throw new Error("Home page parse failed");

  // All movies parallel
  const posts = await Promise.all(movies.map(scrapeMovie));

  return {
    success: true,
    scraped_at: new Date().toISOString(),
    count: posts.length,
    posts,
  };
}

module.exports = { scrapeTopMovies };
