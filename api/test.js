// その端末にテスト通知を即時送信する（POST {deviceId, key}）
import { findBlob, readRecord, deleteRecord, allowedOrigin, checkKey, setupPush, sendTo, json } from "./_lib.js";

export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { ok: false, error: "method" }); }
    if (!allowedOrigin(req)) return json(res, 403, { ok: false, error: "origin" });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (!checkKey(body)) return json(res, 401, { ok: false, error: "key" });
    if (!/^[a-z0-9]{16,64}$/.test(body.deviceId || "")) return json(res, 400, { ok: false, error: "deviceId" });
    const b = await findBlob(body.deviceId);
    if (!b) return json(res, 404, { ok: false, error: "not registered" });
    const rec = await readRecord(b);
    setupPush();
    const r = await sendTo(rec.sub, { title: "お金の流れマップ", body: "通知はこのように届きます。", url: "/" });
    if (r === "gone") await deleteRecord(rec.deviceId);
    return json(res, r === "ok" ? 200 : 502, { ok: r === "ok", result: r });
  } catch (e) {
    console.error("test", e);
    return json(res, 400, { ok: false, error: String(e.message || e) });
  }
}
