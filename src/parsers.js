const cheerio = require("cheerio");

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

// Home page → movie list
function parseHome(html, limit = 5) {
  const $ = cheerio.load(html);
  const items = [];

  $(".A10").each((i, el) => {
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

// Movie detail page
function parseDetail(html) {
  const $ = cheerio.load(html);

  const field = (label) => {
    const el = $(`.fname`).filter((_, e) =>
      $(e).text().startsWith(label)
    ).first();
    return clean(el.find("[class^='color']").text()) || null;
  };

  const dlLink = $("a.dl").attr("href") || null;
  const linkmakeMatch = dlLink
    ? dlLink.match(/linkmake\.in\/view\/([A-Za-z0-9]+)/)
    : null;

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

// Linkmake page → filesdl quality links
function parseLinkmake(html) {
  const $ = cheerio.load(html);
  const links = [];

  $(".dlink.dl a").each((_, el) => {
    const url = $(el).attr("href") || "";
    const label = clean($(el).find(".dll").text());
    const match = url.match(/new\d+\.filesdl\.in\/(cloud|drive)\/([A-Za-z0-9]+)/);
    if (!match) return;
    links.push({
      label,
      type: match[1],
      code: match[2],
      filesdlUrl: url,
    });
  });

  return links;
}

// FileDL page → final server links
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
    let label = clean($(el).text());
    const cls = $(el).attr("class") || "";

    if (!label || label.length < 2) return;
    if (url.includes("t.me") && label.toLowerCase().includes("telegram")) {
      // keep telegram link
    }

    let finalUrl = url;
    if (cls.includes("download-link")) {
      finalUrl =
        url + "&token=" + Math.floor(1000000000 + Math.random() * 9000000000);
    }

    links.push({ label, url: finalUrl });
  });

  return { fileName, size, links };
}

module.exports = { parseHome, parseDetail, parseLinkmake, parseFilesdl, clean };
