// 共通処理: 暗号化、Blob の読み書き、「明日」の判定、通知文面
import crypto from "node:crypto";
import { put, list, del } from "@vercel/blob";
import webpush from "web-push";

const PREFIX = "subs/";

export function env(name, required = true) {
  const v = process.env[name];
  if (required && !v) throw new Error(`環境変数 ${name} がありません`);
  return v || "";
}

// ---- 暗号化（Blob の中身は VAPID 秘密鍵から導いた鍵で AES-256-GCM）----
function blobKey() {
  return crypto.createHash("sha256").update("moneymap-blob:" + env("VAPID_PRIVATE")).digest();
}
export function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", blobKey(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}
export function decrypt(buf) {
  const b = Buffer.from(buf);
  const iv = b.subarray(0, 12), tag = b.subarray(12, 28), body = b.subarray(28);
  const d = crypto.createDecipheriv("aes-256-gcm", blobKey(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(body), d.final()]).toString("utf8"));
}

// ---- Blob ----
export const pathOf = (deviceId) => `${PREFIX}${deviceId}.bin`;
export async function saveRecord(rec) {
  return put(pathOf(rec.deviceId), encrypt(rec), {
    access: "public", addRandomSuffix: false, allowOverwrite: true,
    contentType: "application/octet-stream", cacheControlMaxAge: 60,
  });
}
export async function listRecords() {
  const out = []; let cursor;
  do {
    const r = await list({ prefix: PREFIX, cursor, limit: 1000 });
    out.push(...r.blobs); cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}
export async function findBlob(deviceId) {
  const r = await list({ prefix: pathOf(deviceId), limit: 1 });
  return r.blobs.find((b) => b.pathname === pathOf(deviceId)) || null;
}
export async function readRecord(blob) {
  const res = await fetch(blob.url + "?t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error(`blob read ${res.status}`);
  return decrypt(await res.arrayBuffer());
}
export async function deleteRecord(deviceId) {
  const b = await findBlob(deviceId);
  if (b) await del(b.url);
  return !!b;
}

// ---- 日付（日本時間）----
export function jstToday(now = Date.now()) {
  const t = new Date(now + 9 * 3600e3);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
export function addDays({ y, m, d }, n) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export function parseDate(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s || "");
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

// 規則が日付 D に当たるか（31 は月末、月の日数を超える日も月末扱い）
function hits(rule, D) {
  const dim = daysInMonth(D.y, D.m);
  const day = Number(rule.day);
  const dayHit = day === D.d || (day >= dim && D.d === dim);
  if (rule.month != null) return Number(rule.month) === D.m && dayHit;
  return dayHit;
}

// D に当たる規則をまとめて 1 通の文面にする。該当なしなら null
export function buildMessage(rec, D) {
  const ms = (rec.monthly || []).filter((r) => hits(r, D));
  const ys = (rec.yearly || []).filter((r) => hits(r, D));
  if (!ms.length && !ys.length) return null;
  const all = [...ms, ...ys];
  const n = all.reduce((a, r) => a + (Number(r.n) || 0), 0);
  const sum = all.reduce((a, r) => a + (Number(r.sum) || 0), 0);
  const unset = all.reduce((a, r) => a + (Number(r.unset) || 0), 0);
  const xfer = ms.reduce((a, r) => a + (Number(r.xfer) || 0), 0);
  const approx = all.some((r) => r.approx);
  const yen = (v) => Number(v).toLocaleString("ja-JP") + "円";
  const when = ys.length && !ms.length ? `${D.m}月${D.d}日` : `${D.d}日`;
  const parts = [];
  if (n || unset) {
    let s = `明日（${when}）の支払い: ${n}件`;
    if (sum) s += ` ・ ${approx ? "約" : ""}${yen(sum)}`;
    if (unset) s += ` ＋ 未設定 ${unset}件`;
    if (ys.length && !ms.length) s += "（年払い）";
    parts.push(s);
  }
  if (xfer) parts.push(n || unset ? `振替 ${yen(xfer)}` : `明日（${when}）: 振替 ${yen(xfer)}`);
  return { title: "お金の流れマップ", body: parts.join(" ・ "), url: "/" };
}

// ---- 送信 ----
export function setupPush() {
  webpush.setVapidDetails(env("VAPID_SUBJECT"), env("VAPID_PUBLIC"), env("VAPID_PRIVATE"));
}
// 戻り値: "ok" | "gone"（宛先失効）| "error"
export async function sendTo(sub, payload) {
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 20 * 3600 });
    return "ok";
  } catch (e) {
    if (e && (e.statusCode === 404 || e.statusCode === 410)) return "gone";
    console.error("push error", e && e.statusCode, e && e.body);
    return "error";
  }
}

// ---- 入力検査 ----
export function validateRecord(b) {
  const err = (m) => { throw new Error(m); };
  if (!b || typeof b !== "object") err("本文が JSON ではありません");
  if (!/^[a-z0-9]{16,64}$/.test(b.deviceId || "")) err("deviceId が不正です");
  const s = b.sub;
  if (!s || typeof s.endpoint !== "string" || !s.endpoint.startsWith("https://") || s.endpoint.length > 2000) err("宛先が不正です");
  if (!s.keys || typeof s.keys.p256dh !== "string" || typeof s.keys.auth !== "string") err("宛先の鍵が不正です");
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const rule = (r, yearly) => {
    if (!r || typeof r !== "object") return false;
    if (!int(r.day, 1, 31)) return false;
    if (yearly && !int(r.month, 1, 12)) return false;
    for (const k of ["n", "unset"]) if (r[k] != null && !int(r[k], 0, 1000)) return false;
    for (const k of ["sum", "xfer"]) if (r[k] != null && !(Number.isFinite(r[k]) && r[k] >= 0 && r[k] <= 1e10)) return false;
    return true;
  };
  const monthly = Array.isArray(b.monthly) ? b.monthly : [];
  const yearly = Array.isArray(b.yearly) ? b.yearly : [];
  if (monthly.length > 62 || yearly.length > 400) err("規則が多すぎます");
  if (!monthly.every((r) => rule(r, false)) || !yearly.every((r) => rule(r, true))) err("規則の形式が不正です");
  const hour = int(b.hour, 0, 23) ? b.hour : 20;
  return {
    deviceId: b.deviceId,
    sub: { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } },
    hour,
    monthly: monthly.map((r) => ({ day: r.day, n: r.n || 0, sum: r.sum || 0, approx: !!r.approx, unset: r.unset || 0, xfer: r.xfer || 0 })),
    yearly: yearly.map((r) => ({ month: r.month, day: r.day, n: r.n || 0, sum: r.sum || 0, approx: !!r.approx, unset: r.unset || 0 })),
    ver: String(b.ver || "").slice(0, 40),
    updated: new Date().toISOString(),
  };
}

// ---- 共通の入口チェック ----
export function allowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // 同一オリジンのフォーム送信や curl。合言葉で別途確認する
  const host = req.headers.host;
  const allowed = new Set([`https://${host}`, ...(env("ALLOWED_ORIGINS", false).split(",").map((s) => s.trim()).filter(Boolean))]);
  return allowed.has(origin);
}
export function checkKey(body) {
  const k = env("APP_KEY");
  return typeof body?.key === "string" && body.key.length === k.length && crypto.timingSafeEqual(Buffer.from(body.key), Buffer.from(k));
}
export function json(res, status, obj) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(JSON.stringify(obj));
}
