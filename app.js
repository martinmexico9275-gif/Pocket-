(() => {
  "use strict";

  const STORE_KEY = "pockets:v1";

  const defaultState = () => ({
    settings: {
      currency: "£",
      monthlyIncome: 0,
      startDay: 1,
      warnEnabled: true,
      warnThreshold: 5,
    },
    transactions: [], // { id, type: 'income'|'expense', amount, note, date (YYYY-MM-DD) }
    goals: [],        // { id, name, target, saved }
  });

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return { ...defaultState(), ...parsed, settings: { ...defaultState().settings, ...parsed.settings } };
    } catch (e) {
      console.warn("Could not read saved data, starting fresh.", e);
      return defaultState();
    }
  }

  let state = loadState();

  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  const fmt = (n) => {
    const val = Number(n) || 0;
    const sign = val < 0 ? "-" : "";
    return `${sign}${state.settings.currency}${Math.abs(val).toFixed(2)}`;
  };

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const todayISO = () => new Date().toISOString().slice(0, 10);

  // ---------- Budget period math ----------
  // A "budget month" runs from settings.startDay of one calendar month to the day before
  // startDay of the next. This lets pay-day budgeting (e.g. 25th to 25th) work naturally.
  function currentPeriod(now = new Date()) {
    const startDay = Math.min(Math.max(state.settings.startDay || 1, 1), 28);
    let periodStart = new Date(now.getFullYear(), now.getMonth(), startDay);
    if (now.getDate() < startDay) {
      periodStart = new Date(now.getFullYear(), now.getMonth() - 1, startDay);
    }
    const periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, startDay);
    return { start: periodStart, end: periodEnd };
  }

  function isoDate(d) {
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function txInPeriod(period) {
    const startISO = isoDate(period.start);
    const endISO = isoDate(period.end);
    return state.transactions.filter((t) => t.date >= startISO && t.date < endISO);
  }

  function computeSummary() {
    const period = currentPeriod();
    const txs = txInPeriod(period);
    const income = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const spent = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    const baseIncome = Number(state.settings.monthlyIncome) || 0;
    const totalAvailable = baseIncome + income;

    const now = new Date();
    const msPerDay = 86400000;
    const totalDays = Math.round((period.end - period.start) / msPerDay);
    const daysElapsed = Math.floor((now - period.start) / msPerDay);
    const daysLeft = Math.max(totalDays - daysElapsed, 1);

    const remaining = totalAvailable - spent;
    const dailyAllowance = remaining / daysLeft;

    return { income: baseIncome + income, spent, remaining, daysLeft, totalDays, dailyAllowance, period };
  }

  // ---------- Rendering ----------
  function renderMonthLabel(period) {
    const opts = { day: "numeric", month: "short" };
    const endDisplay = new Date(period.end.getTime() - 86400000);
    document.getElementById("monthLabel").textContent =
      `${period.start.toLocaleDateString(undefined, opts)} – ${endDisplay.toLocaleDateString(undefined, opts)}`;
  }

  function renderDial(summary) {
    const el = document.getElementById("dialFill");
    const amountEl = document.getElementById("dialAmount");
    const subEl = document.getElementById("dialSub");

    const allowance = summary.dailyAllowance;
    amountEl.textContent = fmt(allowance);
    subEl.textContent = `${summary.daysLeft} day${summary.daysLeft === 1 ? "" : "s"} left this period`;

    // Reference scale: treat (base income / total days) as a "full dial" baseline.
    const baseline = summary.income / summary.totalDays || 1;
    const ratio = Math.max(0, Math.min(allowance / (baseline * 1.4 || 1), 1));
    const arcLen = 75; // matches the 75/100 dasharray sweep drawn in HTML
    el.setAttribute("stroke-dashoffset", (arcLen * (1 - ratio)).toFixed(2));

    el.classList.remove("low", "tight", "ok");
    if (allowance <= 0) el.classList.add("low");
    else if (allowance < baseline * 0.5) el.classList.add("tight");
    else el.classList.add("ok");

    const banner = document.getElementById("warningBanner");
    const warnText = document.getElementById("warningText");
    if (state.settings.warnEnabled && allowance < Number(state.settings.warnThreshold || 0)) {
      banner.classList.add("show");
      warnText.textContent = allowance <= 0
        ? "You've used up today's allowance for this period."
        : `Today's allowance is only ${fmt(allowance)}.`;
    } else {
      banner.classList.remove("show");
    }
  }

  function renderStats(summary) {
    document.getElementById("statIncome").textContent = fmt(summary.income);
    document.getElementById("statSpent").textContent = fmt(summary.spent);
  }

  function renderTxList() {
    const list = document.getElementById("txList");
    const sorted = [...state.transactions].sort((a, b) => (a.date < b.date ? 1 : -1) || b.id.localeCompare(a.id));
    if (sorted.length === 0) {
      list.innerHTML = `<div class="empty-state">No transactions yet. Tap + to add your first one.</div>`;
      return;
    }
    list.innerHTML = sorted.slice(0, 40).map((t) => `
      <li class="tx-item" data-id="${t.id}">
        <span class="tx-dot ${t.type}"></span>
        <div class="tx-info">
          <div class="tx-note">${escapeHtml(t.note || (t.type === "income" ? "Income" : "Spending"))}</div>
          <div class="tx-meta">${formatDate(t.date)}</div>
        </div>
        <div class="tx-amount ${t.type}">${t.type === "expense" ? "-" : "+"}${fmt(t.amount)}</div>
        <button class="tx-del" data-del="${t.id}" aria-label="Delete">✕</button>
      </li>
    `).join("");
  }

  function formatDate(iso) {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderGoals() {
    const list = document.getElementById("goalsList");
    const empty = document.getElementById("goalsEmpty");
    if (state.goals.length === 0) {
      list.innerHTML = "";
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";
    list.innerHTML = state.goals.map((g) => {
      const pct = g.target > 0 ? Math.min((g.saved / g.target) * 100, 100) : 0;
      return `
        <div class="goal-card" data-id="${g.id}">
          <div class="goal-top">
            <div class="goal-name">${escapeHtml(g.name)}</div>
            <div class="goal-nums">${fmt(g.saved)} / ${fmt(g.target)}</div>
          </div>
          <div class="goal-bar-track"><div class="goal-bar-fill" style="width:${pct}%"></div></div>
          <div class="goal-actions">
            <button class="btn btn-secondary btn-sm" data-fund="${g.id}">Add funds</button>
            <button class="btn btn-ghost btn-sm" data-delgoal="${g.id}">Delete</button>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderSettings() {
    document.getElementById("currencyInput").value = state.settings.currency;
    document.getElementById("incomeInput").value = state.settings.monthlyIncome || "";
    document.getElementById("warnToggle").checked = !!state.settings.warnEnabled;
    document.getElementById("warnThreshold").value = state.settings.warnThreshold;
    const sel = document.getElementById("startDay");
    if (!sel.options.length) {
      for (let i = 1; i <= 28; i++) {
        const opt = document.createElement("option");
        opt.value = i;
        opt.textContent = ordinal(i);
        sel.appendChild(opt);
      }
    }
    sel.value = state.settings.startDay;
  }

  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function renderAll() {
    const summary = computeSummary();
    renderMonthLabel(summary.period);
    renderDial(summary);
    renderStats(summary);
    renderTxList();
    renderGoals();
    renderSettings();
  }

  // ---------- Tab navigation ----------
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`view-${btn.dataset.view}`).classList.add("active");
    });
  });

  // ---------- Add transaction sheet ----------
  const txBackdrop = document.getElementById("txBackdrop");
  const segExpense = document.getElementById("segExpense");
  const segIncome = document.getElementById("segIncome");
  let currentTxType = "expense";

  document.getElementById("fabAdd").addEventListener("click", () => {
    document.getElementById("txAmount").value = "";
    document.getElementById("txNote").value = "";
    document.getElementById("txDate").value = todayISO();
    currentTxType = "expense";
    segExpense.classList.add("active");
    segIncome.classList.remove("active");
    txBackdrop.classList.add("show");
    setTimeout(() => document.getElementById("txAmount").focus(), 50);
  });

  segExpense.addEventListener("click", () => {
    currentTxType = "expense";
    segExpense.classList.add("active");
    segIncome.classList.remove("active");
  });
  segIncome.addEventListener("click", () => {
    currentTxType = "income";
    segIncome.classList.add("active");
    segExpense.classList.remove("active");
  });

  document.getElementById("txCancel").addEventListener("click", () => txBackdrop.classList.remove("show"));
  txBackdrop.addEventListener("click", (e) => { if (e.target === txBackdrop) txBackdrop.classList.remove("show"); });

  document.getElementById("txSave").addEventListener("click", () => {
    const amount = parseFloat(document.getElementById("txAmount").value);
    if (!amount || amount <= 0) return;
    const note = document.getElementById("txNote").value.trim();
    const date = document.getElementById("txDate").value || todayISO();
    state.transactions.push({ id: uid(), type: currentTxType, amount, note, date });
    save();
    txBackdrop.classList.remove("show");
    renderAll();
  });

  document.getElementById("txList").addEventListener("click", (e) => {
    const delId = e.target.getAttribute("data-del");
    if (delId) {
      state.transactions = state.transactions.filter((t) => t.id !== delId);
      save();
      renderAll();
    }
  });

  // ---------- Goals ----------
  const goalBackdrop = document.getElementById("goalBackdrop");
  document.getElementById("newGoalBtn").addEventListener("click", () => {
    document.getElementById("goalName").value = "";
    document.getElementById("goalTarget").value = "";
    goalBackdrop.classList.add("show");
  });
  document.getElementById("goalCancel").addEventListener("click", () => goalBackdrop.classList.remove("show"));
  goalBackdrop.addEventListener("click", (e) => { if (e.target === goalBackdrop) goalBackdrop.classList.remove("show"); });

  document.getElementById("goalSave").addEventListener("click", () => {
    const name = document.getElementById("goalName").value.trim();
    const target = parseFloat(document.getElementById("goalTarget").value);
    if (!name || !target || target <= 0) return;
    state.goals.push({ id: uid(), name, target, saved: 0 });
    save();
    goalBackdrop.classList.remove("show");
    renderAll();
  });

  const addFundsBackdrop = document.getElementById("addFundsBackdrop");
  let fundingGoalId = null;

  document.getElementById("goalsList").addEventListener("click", (e) => {
    const fundId = e.target.getAttribute("data-fund");
    const delId = e.target.getAttribute("data-delgoal");
    if (fundId) {
      fundingGoalId = fundId;
      document.getElementById("addFundsAmount").value = "";
      addFundsBackdrop.classList.add("show");
    } else if (delId) {
      state.goals = state.goals.filter((g) => g.id !== delId);
      save();
      renderAll();
    }
  });

  document.getElementById("addFundsCancel").addEventListener("click", () => addFundsBackdrop.classList.remove("show"));
  addFundsBackdrop.addEventListener("click", (e) => { if (e.target === addFundsBackdrop) addFundsBackdrop.classList.remove("show"); });

  document.getElementById("addFundsSave").addEventListener("click", () => {
    const amount = parseFloat(document.getElementById("addFundsAmount").value);
    if (!amount || amount <= 0 || !fundingGoalId) return;
    const goal = state.goals.find((g) => g.id === fundingGoalId);
    if (goal) {
      goal.saved += amount;
      // Also log it as an expense so it affects the daily allowance honestly.
      state.transactions.push({ id: uid(), type: "expense", amount, note: `To goal: ${goal.name}`, date: todayISO() });
      save();
    }
    addFundsBackdrop.classList.remove("show");
    renderAll();
  });

  // ---------- Settings ----------
  document.getElementById("currencyInput").addEventListener("input", (e) => {
    state.settings.currency = e.target.value || "£";
    save(); renderAll();
  });
  document.getElementById("incomeInput").addEventListener("input", (e) => {
    state.settings.monthlyIncome = parseFloat(e.target.value) || 0;
    save(); renderAll();
  });
  document.getElementById("startDay").addEventListener("change", (e) => {
    state.settings.startDay = parseInt(e.target.value, 10) || 1;
    save(); renderAll();
  });
  document.getElementById("warnToggle").addEventListener("change", (e) => {
    state.settings.warnEnabled = e.target.checked;
    save(); renderAll();
  });
  document.getElementById("warnThreshold").addEventListener("input", (e) => {
    state.settings.warnThreshold = parseFloat(e.target.value) || 0;
    save(); renderAll();
  });

  document.getElementById("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pockets-backup-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    if (confirm("This erases all transactions, goals and settings on this device. Continue?")) {
      state = defaultState();
      save();
      renderAll();
    }
  });

  // ---------- Service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW registration failed", err));
    });
  }

  renderAll();
})();
      
