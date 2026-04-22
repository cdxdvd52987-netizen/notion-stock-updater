import fetch from "node-fetch";
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
console.log("NOTION_TOKEN length:", (process.env.NOTION_TOKEN || "").length);
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_KEY;
const DB_ID = process.env.DB_ID; // workflow 會塞 US_DB_ID 或 TW_DB_ID 進來
const MARKET = process.env.MARKET; // US 或 TW

if (!process.env.NOTION_TOKEN || !TWELVE_DATA_KEY || !DB_ID || !MARKET) {
  throw new Error("Missing env: NOTION_TOKEN / TWELVE_DATA_KEY / DB_ID / MARKET");
}

// 取得資料庫所有 rows（至少要拿到 page id + Ticker）
async function getAllPages(database_id) {
  let results = [];
  let cursor = undefined;

  while (true) {
    const resp = await notion.databases.query({
      database_id,
      start_cursor: cursor
    });
    results = results.concat(resp.results);
    if (!resp.has_more) break;
    cursor = resp.next_cursor;
  }
  return results;
}

function getTitle(page, propName) {
  const p = page.properties?.[propName];
  if (!p || p.type !== "title") return null;
  return (p.title || []).map(t => t.plain_text).join("").trim() || null;
}

async function fetchPrice(symbol) {
  // Twelve Data quote endpoint
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(TWELVE_DATA_KEY)}`;
  const r = await fetch(url);
  const data = await r.json();

  // 常見錯誤：{"code":400,"message":"..."} 或 {"status":"error"...}
  if (data.status === "error" || data.code) {
    throw new Error(`TwelveData error for ${symbol}: ${JSON.stringify(data)}`);
  }

  const price = Number(data.close ?? data.price);
  if (!Number.isFinite(price)) throw new Error(`No price for ${symbol}: ${JSON.stringify(data)}`);

  return price;
}

async function main() {
  const pages = await getAllPages(DB_ID);

  // 你的模板：Ticker 是 title 欄位
  const TICKER_PROP = "Ticker";
  const PRICE_PROP = "Current price";
  const UPDATED_PROP = "Current price 最後更新時間";

  let ok = 0, skipped = 0, failed = 0;

  for (const page of pages) {
    const ticker = getTitle(page, TICKER_PROP);
    if (!ticker) { skipped++; continue; }

    // 市場規則（你可以先照這樣）
    // US: AAPL / TSLA
    // TW: 2330.TW / 0050.TW
    if (MARKET === "US" && ticker.includes(".TW")) { skipped++; continue; }
    if (MARKET === "TW" && !ticker.includes(".TW") && !ticker.includes(".TWO")) { skipped++; continue; }

    try {
      const price = await fetchPrice(ticker);

      await notion.pages.update({
        page_id: page.id,
        properties: {
          [PRICE_PROP]: { number: price },
          [UPDATED_PROP]: { date: { start: new Date().toISOString() } }
        }
      });

      ok++;
      console.log(`[OK] ${ticker} -> ${price}`);
    } catch (e) {
      failed++;
      console.log(`[FAIL] ${ticker}: ${e.message}`);
    }
  }

  console.log(`Done. ok=${ok}, skipped=${skipped}, failed=${failed}`);
}

main();
