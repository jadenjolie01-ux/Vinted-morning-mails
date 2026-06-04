import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import nodemailer from "nodemailer";
import { chromium } from "playwright";

const rootDir = process.cwd();
const statePath = path.join(rootDir, "cloud_state", "sent_links.json");
const blacklistPath = path.join(rootDir, "vinted_rejected_or_stale_links.txt");

const requiredEnv = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "MAIL_FROM",
  "MAIL_TO"
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

const categoryConfigs = {
  sneakers: {
    subject: "Vinted sneaker deals van vandaag - Jaden en Jelle",
    minCount: 8,
    maxCount: 12,
    queries: [
      "nike air max",
      "air force 1",
      "new balance 530",
      "new balance 9060",
      "asics gel nyc",
      "asics gel kayano",
      "salomon xt"
    ],
    validate: (item) =>
      item.locationOk &&
      item.available &&
      item.recentListing &&
      item.recentSeller &&
      item.sizeOk &&
      item.safeEnough
  },
  clothing: {
    subject: "Vinted kleding deals van vandaag - Jaden en Jelle",
    minCount: 8,
    maxCount: 12,
    queries: [
      "carhartt hoodie",
      "ralph lauren hoodie",
      "lacoste polo",
      "patagonia fleece",
      "levis jacket",
      "daily paper hoodie",
      "fred perry polo",
      "tommy hilfiger sweater"
    ],
    validate: (item) =>
      item.locationOk &&
      item.available &&
      item.recentListing &&
      item.recentSeller &&
      item.safeEnough
  }
};

function readBlacklist() {
  if (!fs.existsSync(blacklistPath)) {
    return new Set();
  }

  return new Set(
    fs
      .readFileSync(blacklistPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
  );
}

function loadState() {
  if (!fs.existsSync(statePath)) {
    return { sentLinks: [] };
  }

  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return { sentLinks: [] };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function uniqueByLink(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.link)) {
      return false;
    }

    seen.add(item.link);
    return true;
  });
}

function scoreItem(item) {
  let score = 0;
  if (item.recentListing) score += 3;
  if (item.recentSeller) score += 3;
  if (item.locationOk) score += 2;
  if (item.safeEnough) score += 3;
  if (item.available) score += 4;
  if (item.price <= 30) score += 2;
  if (item.price <= 60) score += 1;
  return score;
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function parseEuro(text) {
  const match = text.match(/(\d+[\.,]?\d{0,2})/);
  if (!match) {
    return null;
  }

  return Number(match[1].replace(",", "."));
}

function isRecentListing(pageText) {
  const text = pageText.toLowerCase();
  if (
    text.includes("zojuist") ||
    text.includes("min geleden") ||
    text.includes("uur geleden") ||
    text.includes("een dag geleden") ||
    text.includes("1 dag geleden") ||
    text.includes("2 dagen geleden") ||
    text.includes("3 dagen geleden")
  ) {
    return true;
  }

  return false;
}

function isRecentSeller(pageText) {
  const text = pageText.toLowerCase();
  if (
    text.includes("online") ||
    text.includes("vandaag") ||
    text.includes("min geleden") ||
    text.includes("uur geleden") ||
    text.includes("een dag geleden") ||
    text.includes("1 dag geleden")
  ) {
    return true;
  }

  return false;
}

function isAvailable(pageText) {
  const text = pageText.toLowerCase();
  const blocked = [
    "verkocht",
    "gereserveerd",
    "verborgen",
    "verwijderd",
    "niet beschikbaar",
    "404"
  ];
  if (blocked.some((token) => text.includes(token))) {
    return false;
  }

  return (
    text.includes("een bod doen") ||
    text.includes("bericht sturen") ||
    text.includes("kopen")
  );
}

function isConcreteDutchLocation(locationText) {
  const normalized = normalizeWhitespace(locationText);
  if (!normalized.toLowerCase().includes("nederland")) {
    return false;
  }

  return !normalized.toLowerCase().includes("nederland, nederland");
}

function isSafeEnough(title, pageText) {
  const lowerTitle = title.toLowerCase();
  const lowerText = pageText.toLowerCase();
  const fakeSensitive = ["stone island", "arc'teryx", "arcteryx", "supreme", "cp company", "jordan"];
  if (!fakeSensitive.some((name) => lowerTitle.includes(name))) {
    return true;
  }

  const proofSignals = ["certilogo", "productcode", "doos", "verificatie", "sku", "waslabel"];
  return proofSignals.some((signal) => lowerText.includes(signal));
}

function sizeLooksValid(pageText) {
  const text = pageText.toLowerCase();
  return /\b42\b|\b43\b|\b44\b/.test(text);
}

function estimateResale(item, kind) {
  const multiplier = kind === "sneakers" ? 1.7 : 2.0;
  const floor = kind === "sneakers" ? 25 : 20;
  return Math.max(Math.round((item.price ?? floor) * multiplier), (item.price ?? floor) + 20);
}

function estimateNet(item, kind) {
  const price = item.price ?? (kind === "sneakers" ? 35 : 20);
  const totalCost = price + 6;
  return estimateResale(item, kind) - totalCost;
}

async function scrapeSearch(page, query) {
  const url = `https://www.vinted.nl/catalog?search_text=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(4000);

  return page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href*="/items/"]'));
    return anchors.slice(0, 40).map((anchor) => {
      const href = anchor.href;
      const title = anchor.textContent?.trim() || "";
      return { href, title };
    });
  });
}

async function inspectItem(page, link, kind) {
  await page.goto(link, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2500);

  const payload = await page.evaluate(() => {
    const title = document.querySelector("h1")?.textContent?.trim() || document.title;
    const pageText = document.body?.innerText || "";
    const priceText =
      document.querySelector('[data-testid="item-price"]')?.textContent ||
      document.querySelector("h2")?.textContent ||
      "";
    return { title, pageText, priceText };
  });

  const pageText = normalizeWhitespace(payload.pageText);
  const title = normalizeWhitespace(payload.title);
  const locationMatch = pageText.match(/([A-ZÀ-ÿ' -]+,\s*Nederland)/);
  const location = locationMatch ? normalizeWhitespace(locationMatch[1]) : "";
  const price = parseEuro(payload.priceText);

  return {
    kind,
    title,
    link,
    price,
    location,
    pageText,
    available: isAvailable(pageText),
    recentListing: isRecentListing(pageText),
    recentSeller: isRecentSeller(pageText),
    locationOk: isConcreteDutchLocation(location),
    safeEnough: isSafeEnough(title, pageText),
    sizeOk: kind !== "sneakers" || sizeLooksValid(pageText)
  };
}

function renderMail(kind, items, reason) {
  const intro =
    kind === "sneakers"
      ? "Nieuwe live sneakerdeals van Vinted Nederland."
      : kind === "clothing"
        ? "Nieuwe live kledingdeals van Vinted Nederland."
        : "Beste gecombineerde topdeals van Vinted Nederland.";

  if (!items.length) {
    return `
      <p>Hoi Jaden en Jelle,</p>
      <p>${intro}</p>
      <p>Er zijn nu geen betrouwbare deals doorgestuurd.</p>
      <p>Reden: ${reason}</p>
    `;
  }

  const blocks = items.map((item, index) => {
    const resale = estimateResale(item, kind === "top6" && item.kind ? item.kind : kind);
    const net = estimateNet(item, kind === "top6" && item.kind ? item.kind : kind);
    return `
      <hr />
      <p><strong>${index + 1}. ${item.title}</strong></p>
      <p>Link: <a href="${item.link}">${item.link}</a></p>
      <p>Vraagprijs: €${(item.price ?? 0).toFixed(2)} | Locatie: ${item.location || "onbekend"}</p>
      <p>Check: live pagina open, koop-/biedmogelijkheid zichtbaar, recente listing en recente verkoperactiviteit.</p>
      <p>Geschatte resale: €${resale} | Geschatte nettowinst: €${net}</p>
    `;
  });

  return `
    <p>Hoi Jaden en Jelle,</p>
    <p>${intro}</p>
    ${blocks.join("\n")}
  `;
}

async function sendMail(subject, html) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: process.env.MAIL_TO,
    subject,
    html
  });
}

async function buildCategory(browser, categoryKey, config, blacklist, stateLinks) {
  const page = await browser.newPage();
  const rawCandidates = [];

  for (const query of config.queries) {
    const searchResults = await scrapeSearch(page, query);
    for (const result of searchResults) {
      if (!result.href?.includes("/items/")) {
        continue;
      }

      if (blacklist.has(result.href) || stateLinks.has(result.href)) {
        continue;
      }

      rawCandidates.push(result.href);
    }
  }

  const candidates = [...new Set(rawCandidates)].slice(0, 50);
  const validated = [];

  for (const link of candidates) {
    try {
      const item = await inspectItem(page, link, categoryKey);
      if (config.validate(item) && estimateNet(item, categoryKey) >= 20) {
        validated.push(item);
      }
    } catch {
      // Skip flaky or blocked pages.
    }
  }

  await page.close();
  return uniqueByLink(validated)
    .sort((a, b) => scoreItem(b) - scoreItem(a))
    .slice(0, config.maxCount);
}

async function main() {
  const blacklist = readBlacklist();
  const state = loadState();
  const stateLinks = new Set(state.sentLinks || []);
  const browser = await chromium.launch({ headless: true });

  try {
    const sneakers = await buildCategory(
      browser,
      "sneakers",
      categoryConfigs.sneakers,
      blacklist,
      stateLinks
    );
    const clothing = await buildCategory(
      browser,
      "clothing",
      categoryConfigs.clothing,
      blacklist,
      stateLinks
    );

    const top6 = uniqueByLink([...sneakers, ...clothing])
      .sort((a, b) => scoreItem(b) - scoreItem(a))
      .slice(0, 6);

    await sendMail(
      categoryConfigs.sneakers.subject,
      renderMail("sneakers", sneakers, "geen live sneakerlinks die alle checks haalden")
    );
    await sendMail(
      categoryConfigs.clothing.subject,
      renderMail("clothing", clothing, "geen live kledinglinks die alle checks haalden")
    );
    await sendMail(
      "Top 6 Vinted deals vandaag - Jaden en Jelle",
      renderMail("top6", top6, "geen live topdeals die alle checks haalden")
    );

    const sentLinks = uniqueByLink([...sneakers, ...clothing, ...top6])
      .map((item) => item.link)
      .slice(0, 400);

    saveState({
      sentLinks,
      updatedAt: new Date().toISOString()
    });
  } finally {
    await browser.close();
  }
}

await main();
