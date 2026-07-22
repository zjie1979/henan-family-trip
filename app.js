(function () {
  "use strict";

  const DATA = window.TRIP_DATA;
  const STORAGE_KEY = "henan-family-trip.v1";
  const APP_VERSION = 1;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const defaultState = {
    version: APP_VERSION,
    checks: {},
    notes: { driver: "", booking: "", emergency: "" },
    selectedDayId: "d1",
    activeView: "today"
  };

  let state = loadState();
  let toastTimer;

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return structuredClone(defaultState);
      return {
        ...structuredClone(defaultState),
        ...parsed,
        checks: parsed.checks && typeof parsed.checks === "object" ? parsed.checks : {},
        notes: { ...defaultState.notes, ...(parsed.notes || {}) }
      };
    } catch (_) {
      return structuredClone(defaultState);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function allTaskIds() {
    return [
      ...DATA.quickTasks.map((task) => task.id),
      ...DATA.prepGroups.flatMap((group) => group.tasks.map((task) => task.id)),
      ...DATA.days.flatMap((day) => day.items.map((item) => item.id))
    ];
  }

  function countDone(ids) {
    const done = ids.filter((id) => Boolean(state.checks[id])).length;
    return { done, total: ids.length, percent: ids.length ? Math.round((done / ids.length) * 100) : 0 };
  }

  function toggleCheck(id, checked) {
    state.checks[id] = checked;
    saveState();
    renderAllProgress();

    const day = DATA.days.find((item) => item.items.some((task) => task.id === id));
    if (day) {
      const result = countDone(day.items.map((item) => item.id));
      if (result.total && result.done === result.total) showToast(`${day.short} 全部完成，今天辛苦啦！`);
    }
  }

  function checkRow(task, options = {}) {
    const checked = Boolean(state.checks[task.id]);
    const meta = options.meta ? `<span class="check-meta">${escapeHtml(options.meta)}</span>` : "";
    return `
      <label class="check-row">
        <input type="checkbox" data-check-id="${escapeHtml(task.id)}" ${checked ? "checked" : ""} />
        <span class="check-mark" aria-hidden="true"></span>
        <span class="check-copy">
          <strong>${escapeHtml(task.title)}</strong>
          ${task.note ? `<small>${escapeHtml(task.note)}</small>` : ""}
        </span>
        ${meta}
      </label>`;
  }

  function bindCheckInputs(root = document) {
    $$('[data-check-id]', root).forEach((input) => {
      input.addEventListener("change", () => toggleCheck(input.dataset.checkId, input.checked));
    });
  }

  function getTripPhase() {
    const now = new Date();
    const start = new Date(DATA.meta.startDate);
    const end = new Date(DATA.meta.endDate);
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (now < start) {
      const days = Math.ceil((startDay - today) / 86400000);
      return { type: "before", text: days > 0 ? `距离出发还有 ${days} 天，先把准备清单勾完。` : "明天出发，重点核对证件和集合时间。" };
    }
    if (now > end) return { type: "after", text: "旅程已经结束，打卡记录仍保存在这台设备。" };
    const dateKey = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")
    ].join("-");
    const day = DATA.days.find((item) => item.isoDate === dateKey) || DATA.days[0];
    return { type: "during", day, text: `${day.date}｜${day.route}` };
  }

  function getHomeDay() {
    const phase = getTripPhase();
    if (phase.type === "during") return phase.day;
    return DATA.days.find((day) => day.id === state.selectedDayId) || DATA.days[0];
  }

  function renderToday() {
    const phase = getTripPhase();
    const day = getHomeDay();
    $("#tripPhaseText").textContent = phase.text;
    $("#todayDateLabel").textContent = phase.type === "before" ? "出发前" : day.date;

    let focus;
    if (phase.type === "before") {
      const allPrep = DATA.prepGroups.flatMap((group) => group.tasks);
      focus = allPrep.find((task) => !state.checks[task.id]) || { title: "出发准备已经完成", note: "出发前一天再做最终复核。", id: "" };
      $("#todayFocusCard").innerHTML = `
        <div class="focus-top">
          <span class="focus-time">准备</span>
          <div><h4>${escapeHtml(focus.title)}</h4><p>${escapeHtml(focus.note || "")}</p></div>
        </div>
        <div class="focus-action"><span>下一项准备</span><button type="button" data-focus-action="prep">去打卡</button></div>`;
    } else {
      const item = day.items.find((task) => !state.checks[task.id]) || day.items.at(-1);
      focus = item;
      $("#todayFocusCard").innerHTML = `
        <div class="focus-top">
          <span class="focus-time">${escapeHtml(item.time)}</span>
          <div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.detail)}</p></div>
        </div>
        <div class="focus-action"><span>${escapeHtml(day.route)}</span><button type="button" data-focus-action="journey">打开当天</button></div>`;
    }

    $("#todayFocusCard [data-focus-action]").addEventListener("click", (event) => switchView(event.currentTarget.dataset.focusAction));
    $("#quickChecklist").innerHTML = DATA.quickTasks.map((task) => checkRow(task)).join("");
    bindCheckInputs($("#quickChecklist"));
    $("#todayGlance").innerHTML = `
      <div class="glance-item"><span>路线</span><strong>${escapeHtml(day.route)}</strong></div>
      <div class="glance-item"><span>住宿</span><strong>${escapeHtml(day.hotel)}</strong></div>
      <div class="glance-item"><span>午餐</span><strong>${escapeHtml(day.meals.lunch)}</strong></div>
      <div class="glance-item"><span>晚餐</span><strong>${escapeHtml(day.meals.dinner)}</strong></div>`;
  }

  function renderPrep() {
    $("#prepGroups").innerHTML = DATA.prepGroups.map((group) => {
      const progress = countDone(group.tasks.map((task) => task.id));
      return `
        <section class="prep-group" data-prep-group="${group.id}">
          <div class="group-title"><h3>${escapeHtml(group.title)}</h3><span>${progress.done}/${progress.total}</span></div>
          <div class="check-list">${group.tasks.map((task) => checkRow(task)).join("")}</div>
        </section>`;
    }).join("");
    bindCheckInputs($("#prepGroups"));
  }

  function renderDayTabs() {
    $("#dayTabs").innerHTML = DATA.days.map((day) => `
      <button class="day-tab ${day.id === state.selectedDayId ? "active" : ""}" type="button" role="tab" aria-selected="${day.id === state.selectedDayId}" data-day-id="${day.id}">
        <strong>${day.short}</strong><span>${day.dateShort}</span>
      </button>`).join("");
    $$('[data-day-id]', $("#dayTabs")).forEach((button) => button.addEventListener("click", () => {
      state.selectedDayId = button.dataset.dayId;
      saveState();
      renderJourney();
    }));
  }

  function renderJourney() {
    renderDayTabs();
    const day = DATA.days.find((item) => item.id === state.selectedDayId) || DATA.days[0];
    const progress = countDone(day.items.map((item) => item.id));
    $("#dayDetail").innerHTML = `
      <section class="day-hero">
        <div class="day-hero-main">
          <p>${escapeHtml(day.date)}｜${escapeHtml(day.route)}</p>
          <h3>${escapeHtml(day.title)}</h3>
          <strong>住宿：${escapeHtml(day.hotel)}</strong>
        </div>
        <div class="day-progress">
          <div class="day-progress-head"><span>当天进度</span><strong>${progress.done}/${progress.total}</strong></div>
          <div class="progress-track"><span style="width:${progress.percent}%"></span></div>
        </div>
      </section>
      <div class="timeline">
        ${day.items.map((item) => `
          <label class="timeline-card ${state.checks[item.id] ? "done" : ""}">
            <span class="timeline-time">${escapeHtml(item.time)}</span>
            <input type="checkbox" data-check-id="${escapeHtml(item.id)}" ${state.checks[item.id] ? "checked" : ""} hidden />
            <span class="check-mark" aria-hidden="true"></span>
            <span><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.detail)}</p></span>
          </label>`).join("")}
      </div>
      <div class="day-info-grid">
        <section class="day-info-card"><h4>交通安排</h4><ul>${day.transport.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>
        <section class="day-info-card meals"><h4>吃什么</h4><p><strong>午餐：</strong>${escapeHtml(day.meals.lunch)}</p><p><strong>晚餐：</strong>${escapeHtml(day.meals.dinner)}</p></section>
        <section class="day-info-card alert"><h4>当天提醒</h4><ul>${day.reminders.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>
      </div>`;
    bindCheckInputs($("#dayDetail"));
  }

  function renderInfo() {
    const renderCards = (cards) => cards.map((card) => `
      <article class="stack-item"><span class="tag">${escapeHtml(card.tag)}</span><strong>${escapeHtml(card.title)}</strong><p>${escapeHtml(card.note)}</p></article>`).join("");
    $("#transportCards").innerHTML = renderCards(DATA.transportCards);
    $("#hotelCards").innerHTML = renderCards(DATA.hotelCards);
    $$('[data-note-key]').forEach((field) => {
      field.value = state.notes[field.dataset.noteKey] || "";
      field.oninput = () => {
        state.notes[field.dataset.noteKey] = field.value;
        saveState();
        $("#noteSaveStatus").textContent = "已保存在当前设备";
        window.clearTimeout(field._saveTimer);
        field._saveTimer = window.setTimeout(() => { $("#noteSaveStatus").textContent = ""; }, 1600);
      };
    });
  }

  function renderAllProgress() {
    const overall = countDone(allTaskIds());
    $("#overallProgressValue").textContent = `${overall.percent}%`;
    $("#overallProgressOrb").style.setProperty("--progress", overall.percent);

    const quick = countDone(DATA.quickTasks.map((task) => task.id));
    $("#quickCount").textContent = `${quick.done}/${quick.total}`;

    const prepIds = DATA.prepGroups.flatMap((group) => group.tasks.map((task) => task.id));
    const prep = countDone(prepIds);
    $("#prepProgressLabel").textContent = `${prep.done}/${prep.total}`;
    $("#prepProgressBar").style.width = `${prep.percent}%`;

    if ($('[data-view="prep"]').classList.contains("active")) renderPrep();
    if ($('[data-view="journey"]').classList.contains("active")) renderJourney();
    if ($('[data-view="today"]').classList.contains("active")) renderToday();
  }

  function switchView(target, options = {}) {
    const view = target || "today";
    state.activeView = view;
    saveState();
    $$('.view').forEach((section) => section.classList.toggle("active", section.dataset.view === view));
    $$('.nav-button').forEach((button) => button.classList.toggle("active", button.dataset.target === view));
    if (view === "today") renderToday();
    if (view === "prep") renderPrep();
    if (view === "journey") renderJourney();
    if (view === "info") renderInfo();
    renderAllProgress();
    if (!options.noHash) history.replaceState(null, "", `#${view}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function exportBackup() {
    const payload = { app: "henan-family-trip", exportedAt: new Date().toISOString(), state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `henan-trip-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("备份文件已导出");
  }

  function importBackup(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result));
        const imported = payload.state || payload;
        if (!imported || typeof imported.checks !== "object") throw new Error("invalid");
        state = {
          ...structuredClone(defaultState),
          ...imported,
          checks: imported.checks || {},
          notes: { ...defaultState.notes, ...(imported.notes || {}) }
        };
        saveState();
        renderToday(); renderPrep(); renderJourney(); renderInfo(); renderAllProgress();
        showToast("备份已恢复");
      } catch (_) {
        showToast("备份文件无法识别");
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    if (!window.confirm("确定清空全部打卡和本机私密备注吗？此操作无法撤销。")) return;
    state = structuredClone(defaultState);
    saveState();
    renderToday(); renderPrep(); renderJourney(); renderInfo(); renderAllProgress();
    showToast("全部打卡已清空");
  }

  function bindStaticEvents() {
    $$('.nav-button').forEach((button) => button.addEventListener("click", () => switchView(button.dataset.target)));
    $("#openCurrentDay").addEventListener("click", () => {
      state.selectedDayId = getHomeDay().id;
      switchView("journey");
    });
    $("#exportButton").addEventListener("click", exportBackup);
    $("#importInput").addEventListener("change", (event) => importBackup(event.target.files[0]));
    $("#resetButton").addEventListener("click", resetAll);

    const modal = $("#installModal");
    const closeModal = () => { modal.hidden = true; };
    $("#installHelpButton").addEventListener("click", () => { modal.hidden = false; });
    $("#closeInstallModal").addEventListener("click", closeModal);
    $("#installDoneButton").addEventListener("click", closeModal);
    modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(); });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }

  function init() {
    renderToday();
    renderPrep();
    renderJourney();
    renderInfo();
    bindStaticEvents();
    const hashView = location.hash.replace("#", "");
    const initial = ["today", "prep", "journey", "info"].includes(hashView) ? hashView : state.activeView;
    switchView(initial, { noHash: true });
    registerServiceWorker();
  }

  init();
})();
