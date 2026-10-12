import { CONFIG, API_URL } from "./config.js";
import { createXlsx } from "./xlsx-export.js";

const $ = (id) => document.getElementById(id);
// Admin oturum anahtari yalnizca bellekte tutulur, localStorage kullanilmaz.
let adminSessionToken = "";
let csvRows = [];

function notice(id, text, isError = true) {
  const el = $(id);
  el.textContent = text || "";
  el.hidden = !text;
  el.className = `message ${isError ? "error" : "success"}`;
}

function dateTR(value) {
  if (!value) return "Belirlenmedi";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul", day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

function deadlineLocalInput(value) {
  if (!value) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// Tum admin istekleri gecici admin session token'i ile yetkilendirilir.
async function apiRequest(action, payload = {}, useSession = true) {
  if (useSession && !adminSessionToken) {
    throw new Error("Önce admin girişi yapınız.");
  }
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": CONFIG.publishableKey,
      ...(useSession ? { "X-Survey-Admin-Session": adminSessionToken } : {}),
    },
    body: JSON.stringify({ action, ...payload }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    const code = data.error || `HTTP_${response.status}`;
    if (["ADMIN_SESSION_EXPIRED", "ADMIN_LOGIN_REQUIRED"].includes(code)) {
      adminSessionToken = "";
      $("adminDashboardView").hidden = true;
      $("adminLoginView").hidden = false;
    }
    throw new Error(errors[code] || `İşlem başarısız: ${code}`);
  }
  return data;
}

const errors = {
  ADMIN_LOGIN_REQUIRED: "Admin girişi yapınız.",
  ADMIN_SESSION_EXPIRED: "Admin oturumunuz sona erdi. Yeniden giriş yapınız.",
  INVALID_ADMIN_CODE: "Admin kodu geçersiz.",
  ADMIN_NOT_CONFIGURED: "Admin kodu henüz oluşturulmadı.",
  TOO_MANY_ATTEMPTS: "Çok sayıda yanlış deneme. Lütfen 15 dakika sonra deneyiniz.",
  QUESTIONS_LOCKED: "İlk cevap kaydedildiği için sorular artık değiştirilemez.",
  FIVE_QUESTIONS_REQUIRED: "Beş sorunun tamamını en az 3 karakter olarak giriniz.",
  INVALID_DEADLINE: "Geçerli bir bitiş tarihi ve saati seçiniz.",
  INVALID_IMPORT_ROW: "CSV'de geçersiz satır var.",
  INVALID_IMPORT_SIZE: "Bir seferde 1–1000 CSV satırı yükleyebilirsiniz.",
  INVALID_REFERENCE: "Yönetici/çalışan referansı yalnızca A-Z, rakam, _ veya - içerebilir.",
  INVALID_NAME: "Geçersiz çalışan veya yönetici adı var.",
  CONFLICTING_MANAGER_NAME: "Aynı yönetici referansı CSV'de farklı isimlerle bulunuyor.",
  CONFLICTING_EMPLOYEE_NAME: "Aynı çalışan referansı CSV'de farklı isimlerle bulunuyor.",
  DATASET_TOO_LARGE: "Bu sürümde raporlanabilecek veri sınırı aşıldı.",
};

async function callAdmin(action, payload = {}) {
  return apiRequest(action, payload, true);
}

$("adminLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  notice("adminLoginMessage", "");
  const code = $("adminCode").value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) {
    notice("adminLoginMessage", "Lütfen 5 karakterli admin kodunu giriniz.");
    return;
  }
  $("adminLoginButton").disabled = true;
  try {
    const data = await apiRequest("admin_login", { admin_code: code }, false);
    adminSessionToken = data.session_token;
    $("adminCode").value = "";
    const overview = await callAdmin("admin_overview");
    $("adminLoginView").hidden = true;
    $("adminDashboardView").hidden = false;
    renderOverview(overview);
  } catch (error) {
    adminSessionToken = "";
    notice("adminLoginMessage", error.message);
  } finally {
    $("adminLoginButton").disabled = false;
  }
});

$("adminLogoutButton").addEventListener("click", async () => {
  try { if (adminSessionToken) await callAdmin("admin_logout"); }
  catch { /* Gecersiz session da lokalde kapatilir. */ }
  adminSessionToken = "";
  csvRows = [];
  $("catalogCsv").value = "";
  $("adminDashboardView").hidden = true;
  $("adminLoginView").hidden = false;
  $("adminCode").value = "";
  notice("adminLoginMessage", "");
});

$("rotateAdminCodeButton").addEventListener("click", async () => {
  if (!confirm("Yeni admin kodu oluşturulsun mu? Eski kod ve tüm açık admin oturumları geçersiz olacak.")) return;
  try {
    const data = await callAdmin("admin_rotate_code");
    adminSessionToken = "";
    $("adminDashboardView").hidden = true;
    $("adminLoginView").hidden = false;
    notice("adminLoginMessage",
      `YENİ ADMIN KODU: ${data.admin_code} — Bu kod yalnız bir kez gösterilir. Güvenli yere kaydedin.`,
      false);
    $("adminCode").focus();
  } catch (error) {
    notice("dashboardMessage", error.message);
  }
});

function renderOverview(data) {
  $("totalManagers").textContent = data.total_managers;
  $("totalSurveys").textContent = data.total_assignments;
  $("completedSurveys").textContent = data.completed_count;
  const pct = data.total_assignments
    ? Math.round(100 * data.completed_count / data.total_assignments) : 0;
  $("completionRate").textContent = `%${pct}`;
  $("deadlineInput").value = deadlineLocalInput(data.deadline_at);

  for (let n = 1; n <= 5; n++) {
    const field = $(`question${n}`);
    field.value = data.questions[n - 1] || "";
    field.disabled = data.questions_locked;
  }
  $("saveQuestionsButton").disabled = data.questions_locked;
  if (data.questions_locked) {
    notice("questionsMessage", "İlk anket kaydedildiği için soru düzenleme kapalıdır.", false);
  } else notice("questionsMessage", "");

  const list = $("managerStatusList");
  list.replaceChildren();
  for (const manager of data.managers) {
    const detail = document.createElement("details");
    detail.className = "manager-summary";
    const summary = document.createElement("summary");
    const left = document.createElement("span");
    left.textContent = `${manager.manager_name} (${manager.manager_ref})`;
    const rate = manager.total ? Math.round(manager.completed / manager.total * 100) : 0;
    const right = document.createElement("span");
    right.className = "muted";
    right.textContent = `${manager.completed}/${manager.total} — %${rate}`;
    summary.append(left, right);
    detail.append(summary);
    const ul = document.createElement("div");
    ul.className = "employee-list";
    for (const item of manager.people) {
      const row = document.createElement("div");
      row.className = "employee-row static";
      const title = document.createElement("span");
      title.textContent = `${item.employee_name} (${item.employee_ref})`;
      const badge = document.createElement("span");
      badge.className = `status ${item.completed ? "done" : "pending"}`;
      badge.textContent = item.completed ? "Tamamlandı" : "Tamamlanmadı";
      row.append(title, badge);
      ul.append(row);
    }
    detail.append(ul);
    list.append(detail);
  }
  if (!data.managers.length) list.textContent = "Henüz yönetici/çalışan aktarılmadı.";
}

async function loadOverview() {
  const data = await callAdmin("admin_overview");
  renderOverview(data);
}

$("refreshButton").addEventListener("click", async () => {
  try {
    await loadOverview();
    notice("dashboardMessage", "Veriler yenilendi.", false);
  } catch (error) { notice("dashboardMessage", error.message); }
});

$("saveDeadlineButton").addEventListener("click", async () => {
  const raw = $("deadlineInput").value;
  if (!raw) { notice("deadlineMessage", "Bitiş tarihi seçiniz."); return; }
  // Turkiye 2026 ve sonrasinda UTC+03, yaz saati degisimi yok.
  // Secilen dakikanin SONUNA kadar cevap kabul eder (ss=59).
  const dt = new Date(`${raw}:59+03:00`);
  if (!Number.isFinite(dt.valueOf())) { notice("deadlineMessage", "Tarih geçersiz."); return; }
  try {
    const data = await callAdmin("admin_set_deadline", { deadline_at: dt.toISOString() });
    notice("deadlineMessage", `Son tarih kaydedildi: ${dateTR(data.deadline_at)}`, false);
  } catch (error) { notice("deadlineMessage", error.message); }
});

$("saveQuestionsButton").addEventListener("click", async () => {
  const questions = [1, 2, 3, 4, 5].map((n) => $(`question${n}`).value.trim());
  if (questions.some((q) => q.length < 3)) {
    notice("questionsMessage", "Beş sorunun tamamını giriniz."); return;
  }
  try {
    await callAdmin("admin_set_questions", { questions });
    notice("questionsMessage", "Beş soru şifrelenerek kaydedildi.", false);
    await loadOverview();
  } catch (error) { notice("questionsMessage", error.message); }
});

function delimiterOf(text) {
  const firstLine = text.split(/\r?\n/)[0] || "";
  const candidates = [",", ";", "\t"];
  return candidates.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
}

// Tirnak icinde virgul, noktalivirgul, cift tirnak ve satir sonunu destekler.
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  if (text.includes("\uFFFD")) throw new Error("CSV UTF-8 formatında değil veya karakterler bozuk.");
  const delimiter = delimiterOf(text);
  const output = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      row.push(value); value = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(value); value = "";
      if (row.some((v) => v.trim())) output.push(row);
      row = [];
    } else value += ch;
  }
  if (quoted) throw new Error("CSV içinde kapanmamış tırnak var.");
  row.push(value);
  if (row.some((v) => v.trim())) output.push(row);
  if (output.length < 2) throw new Error("CSV boş veya başlık satırı yok.");
  const header = output.shift().map((v) => v.trim().toLowerCase());
  const required = ["manager_ref", "manager_name", "employee_ref", "employee_name"];
  const positions = required.map((c) => header.indexOf(c));
  if (positions.some((i) => i < 0)) throw new Error("CSV başlıkları: " + required.join(", "));
  const records = output.map((row, index) => {
    if (row.length !== header.length) throw new Error(`CSV ${index + 2}. satırdaki kolon sayısı yanlış.`);
    return Object.fromEntries(required.map((key, i) => [key, (row[positions[i]] || "").trim()]));
  });
  if (records.length > 1000) throw new Error("Bir seferde en fazla 1000 satır yükleyebilirsiniz.");
  return records;
}

$("catalogCsv").addEventListener("change", async (event) => {
  csvRows = [];
  $("importButton").disabled = true;
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    csvRows = parseCsv(await file.text());
    $("csvPreview").textContent = `${csvRows.length} eşleştirme satırı okundu.`;
    $("importButton").disabled = false;
    notice("importMessage", "");
  } catch (error) {
    $("csvPreview").textContent = "";
    notice("importMessage", error.message);
  }
});

$("importButton").addEventListener("click", async () => {
  if (!csvRows.length) return;
  if (!confirm(`${csvRows.length} satır şifrelenerek yüklenecek. Devam edilsin mi?`)) return;
  $("importButton").disabled = true;
  notice("importMessage", "Aktarım sürüyor...", false);
  try {
    const data = await callAdmin("admin_import", { rows: csvRows });
    notice("importMessage", `${data.managers_processed} yönetici, ${data.employees_processed} çalışan işlendi. ${data.new_assignments} yeni eşleştirme eklendi. Yönetici kod listesini indirmeyi unutmayın.`, false);
    csvRows = [];
    $("catalogCsv").value = "";
    $("csvPreview").textContent = "";
    await loadOverview();
  } catch (error) {
    notice("importMessage", error.message);
  } finally { $("importButton").disabled = csvRows.length === 0; }
});

function safeCsvCell(value) {
  let s = String(value ?? "");
  // Excel CSV formula injection'a karsi korunma.
  if (/^[=+@\-\t\r]/.test(s.trimStart())) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

$("downloadCodesButton").addEventListener("click", async () => {
  if (!confirm("Bu CSV, yöneticilerin erişim kodlarını açık içerecek. Güvenli saklayacak mısınız?")) return;
  try {
    const data = await callAdmin("admin_codes");
    const headers = ["manager_ref", "manager_name", "access_code"];
    const values = [headers, ...data.rows.map((r) => headers.map((k) => r[k]))];
    const csv = "\uFEFF" + values.map((row) => row.map(safeCsvCell).join(",")).join("\r\n");
    saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "yonetici-giris-kodlari.csv");
    notice("importMessage", "Yönetici kod listesi indirildi.", false);
  } catch (error) { notice("importMessage", error.message); }
});

$("excelButton").addEventListener("click", async () => {
  $("excelButton").disabled = true;
  try {
    const data = await callAdmin("admin_export");
    const q = Array.from({ length: 5 }, (_, i) => data.questions[i] || `Soru ${i + 1}`);
    const headers = ["Yönetici ID", "Yönetici", "Çalışan ID", "Çalışan", ...q,
      "Tamamlanma Durumu", "Son Kayıt Zamanı (UTC)"];
    const rows = data.rows.map((r) => [r.manager_ref, r.manager_name,
      r.employee_ref, r.employee_name, ...r.answers, r.status, r.completed_at]);
    const blob = createXlsx(headers, rows);
    saveBlob(blob, `anket-cevaplari-${new Date().toISOString().slice(0, 10)}.xlsx`);
    notice("excelMessage", `${rows.length} satırlık Excel raporu indirildi.`, false);
  } catch (error) { notice("excelMessage", error.message); }
  finally { $("excelButton").disabled = false; }
});
