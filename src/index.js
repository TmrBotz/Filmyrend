const express = require("express");
const { scrapeTopMovies } = require("./scraper");

const app = express();
const PORT = process.env.PORT || 3000;

// Cache — 10 min
let cache = { data: null, ts: 0 };
const CACHE_TTL = 10 * 60 * 1000;

app.get("/", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 5, 10);
    const now = Date.now();

    // Return cache if fresh
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

app.get("/health", (_, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
