// 通知の宛先と支払いの規則を受け取る（POST: 保存／上書き、DELETE: 削除）
import { validateRecord, saveRecord, deleteRecord, allowedOrigin, checkKey, json, short, ID_RE, BadInput } from "./_lib.js";

export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  try {
    if (!allowedOrigin(req)) return json(res, 403, { ok: false, error: "origin" });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (!checkKey(body)) return json(res, 401, { ok: false, error: "key" });
    if (req.method === "POST") {
      const rec = validateRecord(body);
      await saveRecord(rec);
      return json(res, 200, { ok: true, updated: rec.updated, rules: rec.monthly.length + rec.yearly.length });
    }
    if (req.method === "DELETE") {
      if (!ID_RE.test(body.deviceId || "")) return json(res, 400, { ok: false, error: "deviceId" });
      const existed = await deleteRecord(body.deviceId);
      return json(res, 200, { ok: true, existed });
    }
    res.setHeader("Allow", "POST, DELETE");
    return json(res, 405, { ok: false, error: "method" });
  } catch (e) {
    if (e instanceof BadInput || e instanceof SyntaxError) return json(res, 400, { ok: false, error: String(e.message || e) });
    console.error("register", short(req.body && req.body.deviceId), e && e.message);
    return json(res, 500, { ok: false, error: "server" });
  }
}
