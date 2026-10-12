import { CONFIG, API_URL } from "./config.js";

const $ = (id) => document.getElementById(id);
const screens = ["loginView", "expiredView", "listView", "surveyView"];
let sessionToken = "";
let currentEmployeeId = "";
let savedAnswers = [];

function view(name) {
  for (const id of screens) $(id).hidden = id !== name;
}

function showMessage(id, text, error = true) {
  const el = $(id);
  el.hidden = !text;
  el.textContent = text || "";
  el.className = `message ${error ? "error" : "success"}`;
}

function errText(code) {
  const messages = {
    INVALID_CODE: "Yönetici kodu geçersiz.",
    TOO_MANY_ATTEMPTS: "Çok fazla deneme yapıldı. Lütfen 15 dakika sonra yeniden deneyiniz.",
    NOT_AUTHORIZED: "Bu işlem için yetkiniz yok.",
    NOT_ASSIGNED: "Bu çalışan size atanmış değil.",
    ALL_FIVE_REQUIRED: "Beş sorunun tamamını yanıtlayınız.",
    SESSION_EXPIRED: "Oturumunuz sona erdi. Yeniden giriş yapınız.",
    SAVE_NOT_ALLOWED: "Kaydetme süresi dolmuş veya anket şu anda kullanılamıyor.",
    SURVEY_NOT_READY: "Anket henüz açılmamıştır.",
  };
  return messages[code] || "İşlem tamamlanamadı. Lütfen tekrar deneyiniz.";
}

function dateTR(value) {
  if (!value) return "Henüz belirlenmedi";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul", day: "2-digit", month: "long",
    year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

async function request(action, payload = {}) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": CONFIG.publishableKey,
      ...(sessionToken ? { "X-Survey-Session": sessionToken } : {}),
    },
    body: JSON.stringify({ action, ...payload }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    const code = data.error || "NETWORK_ERROR";
    if (code === "EXPIRED") view("expiredView");
    if (code === "SESSION_EXPIRED" || code === "NOT_AUTHORIZED") {
      sessionToken = "";
      view("loginView");
    }
    const error = new Error(errText(code));
    error.code = code;
    throw error;
  }
  return data;
}

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("loginMessage", "");
  const code = $("managerCode").value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) {
    showMessage("loginMessage", "Lütfen 5 karakterli geçerli kod giriniz.");
    return;
  }
  $("loginButton").disabled = true;
  try {
    const data = await request("manager_login", { access_code: code });
    sessionToken = data.session_token;
    $("managerCode").value = "";
    $("managerGreeting").textContent = "Hoş geldiniz";
    await loadEmployees();
  } catch (error) {
    if (error.code !== "EXPIRED") showMessage("loginMessage", error.message);
  } finally {
    $("loginButton").disabled = false;
  }
});

async function loadEmployees() {
  const data = await request("manager_list");
  const list = $("employeeList");
  list.replaceChildren();
  const people = data.employees;
  const completed = people.filter((p) => p.completed).length;
  const percent = people.length ? Math.round(completed / people.length * 100) : 0;
  $("deadlineInfo").textContent = `Son doldurma tarihi: ${dateTR(data.deadline_at)} (Türkiye saati)`;
  $("progressInfo").textContent = `${completed} / ${people.length} anket tamamlandı`;
  $("progressPercent").textContent = `%${percent}`;
  $("progressBar").style.width = `${percent}%`;

  for (const person of people) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "employee-row";
    const name = document.createElement("span");
    name.textContent = person.name;
    const status = document.createElement("span");
    status.className = `status ${person.completed ? "done" : "pending"}`;
    status.textContent = person.completed ? "Tamamlandı" : "Tamamlanmadı";
    row.append(name, status);
    row.addEventListener("click", () => openSurvey(person.id));
    list.appendChild(row);
  }
  if (people.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "Size atanmış çalışan bulunmuyor.";
    list.appendChild(empty);
  }
  showMessage("listMessage", "");
  view("listView");
}

async function openSurvey(employeeId) {
  currentEmployeeId = employeeId;
  showMessage("listMessage", "");
  try {
    const data = await request("manager_survey", { employee_id: employeeId });
    $("employeeTitle").textContent = `${data.employee_name} — Değerlendirme`;
    const holder = $("questionList");
    holder.replaceChildren();
    savedAnswers = Array.isArray(data.answers) ? [...data.answers] : ["", "", "", "", ""];

    for (let i = 0; i < data.questions.length; i++) {
      const question = data.questions[i];
      const fieldset = document.createElement("fieldset");
      fieldset.className = "question";
      const legend = document.createElement("legend");
      legend.textContent = `${i + 1}. ${question.text}`;
      fieldset.appendChild(legend);

      for (const [value, label] of [["yes", "Evet"], ["no", "Hayır"]]) {
        const wrapper = document.createElement("label");
        wrapper.className = "answer-option";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = `answer_${i}`;
        radio.value = value;
        radio.checked = savedAnswers[i] === value;
        radio.addEventListener("change", () => {
          savedAnswers[i] = value;
          $("saveButton").disabled = !savedAnswers.every((a) => a === "yes" || a === "no");
        });
        wrapper.append(radio, document.createTextNode(label));
        fieldset.append(wrapper);
      }
      holder.appendChild(fieldset);
    }
    $("saveButton").disabled = !savedAnswers.every((a) => a === "yes" || a === "no");
    showMessage("surveyMessage", "");
    view("surveyView");
  } catch (error) {
    if (error.code !== "EXPIRED") showMessage("listMessage", error.message);
  }
}

$("surveyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("saveButton").disabled = true;
  showMessage("surveyMessage", "");
  try {
    await request("manager_save", {
      employee_id: currentEmployeeId,
      answers: savedAnswers,
    });
    await loadEmployees();
    showMessage("listMessage", "Cevaplarınız kaydedildi.", false);
  } catch (error) {
    if (error.code !== "EXPIRED") showMessage("surveyMessage", error.message);
  } finally {
    $("saveButton").disabled = !savedAnswers.every((a) => a === "yes" || a === "no");
  }
});

$("backButton").addEventListener("click", () => loadEmployees().catch((e) => {
  if (e.code !== "EXPIRED") showMessage("surveyMessage", e.message);
}));

$("logoutButton").addEventListener("click", async () => {
  try { if (sessionToken) await request("manager_logout"); } catch { /* oturum kapanir */ }
  sessionToken = "";
  currentEmployeeId = "";
  view("loginView");
});
