// 毎日 20 時台（日本時間）に Cron から呼ばれ、「明日」に支払いがある端末へ通知する
import { env, listRecords, readRecord, deleteRecord, jstToday, addDays, parseDate, buildMessage, setupPush, sendTo, json } from "./_lib.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${env("CRON_SECRET")}`) return json(res, 401, { ok: false, error: "auth" });
  // 検証用: ?date=YYYY-MM-DD を「明日」として扱う。?dry=1 なら送らずに文面だけ返す
  const q = req.query || {};
  const D = parseDate(q.date) || addDays(jstToday(), 1);
  const dry = q.dry === "1";
  setupPush();
  const blobs = await listRecords();
  const out = { ok: true, date: `${D.y}-${D.m}-${D.d}`, total: blobs.length, sent: 0, skipped: 0, gone: 0, error: 0, dry, messages: [] };
  for (const b of blobs) {
    let rec;
    try { rec = await readRecord(b); } catch (e) { out.error++; console.error("read", b.pathname, e.message); continue; }
    const msg = buildMessage(rec, D);
    if (!msg) { out.skipped++; continue; }
    if (dry) { out.messages.push({ deviceId: rec.deviceId.slice(0, 6) + "…", body: msg.body }); continue; }
    const r = await sendTo(rec.sub, msg);
    if (r === "ok") out.sent++;
    else if (r === "gone") { out.gone++; await deleteRecord(rec.deviceId); }
    else out.error++;
  }
  return json(res, 200, out);
}
