(() => {
  "use strict";

  const STORE_KEY = "pockets:v1";

  const CATEGORIES = [
    "Groceries", "Transport", "Housing", "Bills", "Health",
    "Entertainment", "Eating out", "Shopping", "Salary", "Other",
  ];

  const CATEGORY_META = {
    "Groceries":   { icon: "🛒", color: "#7CB86A" },
    "Transport":   { icon: "🚌", color: "#4FA8D8" },
    "Housing":     { icon: "🏠", color: "#C98A2C" },
    "Bills":       { icon: "💡", color: "#E0B23E" },
    "Health":      { icon: "🩺", color: "#E8735C" },
    "Entertainment": { icon: "🎬", color: "#A87CE0" },
    "Eating out":  { icon: "🍽️", color: "#E0894F" },
    "Shopping":    { icon: "🛍️", color: "#E05FA0" },
    "Salary":      { icon: "💼", color: "#2AA198" },
    "Other":       { icon: "⚪️", color: "#8A94A0" },
  };
  const catMeta = (cat) => CATEGORY_META[cat] || CATEGORY_META["Other"];

  const WALLET_ICONS = ["💵", "💳", "🏦", "🐖", "📱", "💰"];

  const defaultState = () => ({
    settings: {
      currency: "£",
      monthlyIncome: 0,
      startDay: 1,
      warnEnabled: true,
      warnThreshold: 5,
      theme: "dark",
    },
    transactions: [], // { id, type: 'income'|'expense', amount, note, category, date (YYYY-MM-DD), walletId, recurringId? }
    goals: [],        // { id, name, target, saved, icon }
    recurring: [],    // { id, type, amount, note, category, day, lastPeriodStart, walletId }
    wallets: [
      { id: "w-cash", name: "Cash", icon: "💵", startingBalance: 0 },
      { id: "w-bank", name: "Bank/Card", icon: "💳", startingBalance: 0 },
    ],
  });

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const merged = { ...defaultState(), ...parsed, settings: { ...defaultState().settings, ...parsed.settings } };

      // Migrate pre-wallet saves: fold the old single starting balance into one wallet
      // and attach every existing transaction to it.
      if (!parsed.wallets) {
        const oldBalance = Number(parsed.settings && parsed.settings.startingBalance) || 0;
        const migratedWallet = { id: "w-main", name: "Wallet", icon: "💰", startingBalance: oldBalance };
        merged.wallets = [migratedWallet];
        merged.transactions = merged.transactions.map((t) => ({ ...t, walletId: t.walletId || migratedWallet.id }));
      }
      return merged;
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

  let activeCategory = "all";
  const lastValues = {};

  function animateNumber(el, key, toValue) {
    const from = lastValues[key] !== undefined ? lastValues[key] : toValue;
    lastValues[key] = toValue;
    if (Math.abs(from - toValue) < 0.005) { el.textContent = fmt(toValue); return; }
    const duration = 450;
    const start = performance.now();
    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const current = from + (toValue - from) * eased;
      el.textContent = fmt(current);
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = fmt(toValue);
    }
    requestAnimationFrame(tick);
  }

  // ---------- Theme ----------
  function applyTheme() {
    const theme = state.settings.theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelector('meta[name="theme-color"]').setAttribute(
      "content", theme === "light" ? "#f3efe4" : "#10151a"
    );
  }

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

  // Generate any recurring transactions that are due for the current budget period
  // and haven't been created yet. Runs once per app load.
  function processRecurring() {
    const period = currentPeriod();
    const periodStartISO = isoDate(period.start);
    let changed = false;

    state.recurring.forEach((r) => {
      if (r.lastPeriodStart === periodStartISO) return; // already generated this period

      let dueDate = new Date(period.start.getFullYear(), period.start.getMonth(), r.day);
      if (dueDate < period.start) dueDate = period.start;
      if (dueDate >= period.end) dueDate = new Date(period.end.getTime() - 86400000);
      if (dueDate > new Date()) return; // not due yet this period

      state.transactions.push({
        id: uid(),
        type: r.type,
        amount: r.amount,
        note: r.note,
        category: r.category,
        date: isoDate(dueDate),
        recurringId: r.id,
        walletId: r.walletId || defaultWalletId(),
      });
      r.lastPeriodStart = periodStartISO;
      changed = true;
    });

    if (changed) save();
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
  function computeWalletBalance(walletId) {
    const wallet = state.wallets.find((w) => w.id === walletId);
    if (!wallet) return 0;
    const txs = state.transactions.filter((t) => t.walletId === walletId);
    const income = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const spent = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return (Number(wallet.startingBalance) || 0) + income - spent;
  }

  function computeTotalBalance() {
    return state.wallets.reduce((sum, w) => sum + computeWalletBalance(w.id), 0);
  }

  function defaultWalletId() {
    return state.wallets[0] ? state.wallets[0].id : null;
  }

  function renderWallets() {
    const row = document.getElementById("walletRow");
    let html = `
      <div class="wallet-card total">
        <div class="wallet-label">Ⓣ Total</div>
        <div class="wallet-amount" id="walletTotalAmount">£0.00</div>
      </div>
    `;
    html += state.wallets.map((w) => `
      <div class="wallet-card">
        <div class="wallet-label">${w.icon} ${escapeHtml(w.name)}</div>
        <div class="wallet-amount" id="walletAmount-${w.id}">£0.00</div>
      </div>
    `).join("");
    row.innerHTML = html;

    animateNumber(document.getElementById("walletTotalAmount"), "wallet-total", computeTotalBalance());
    state.wallets.forEach((w) => {
      const el = document.getElementById(`walletAmount-${w.id}`);
      if (el) animateNumber(el, `wallet-${w.id}`, computeWalletBalance(w.id));
    });
  }

  function renderGreeting() {
    const h = new Date().getHours();
    const text = h < 5 ? "Still up?" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    document.getElementById("greeting").textContent = text;
  }

  function renderDialTicks() {
    const g = document.getElementById("dialTicks");
    if (g.childElementCount) return; // draw once
    const cx = 110, cy = 110, rOuter = 108, tickCount = 25;
    const sweepDeg = 244; // matches the ~75% dasharray sweep
    let html = "";
    for (let i = 0; i <= tickCount; i++) {
      const angle = (sweepDeg * (i / tickCount)) * (Math.PI / 180);
      const major = i % 5 === 0;
      const rInner = major ? rOuter - 8 : rOuter - 4;
      const x1 = cx + rInner * Math.cos(angle);
      const y1 = cy + rInner * Math.sin(angle);
      const x2 = cx + rOuter * Math.cos(angle);
      const y2 = cy + rOuter * Math.sin(angle);
      html += `<line class="dial-tick" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke-width="${major ? 2 : 1}"/>`;
    }
    g.innerHTML = html;
  }

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
    animateNumber(amountEl, "dial", allowance);
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
    animateNumber(document.getElementById("statIncome"), "income", summary.income);
    animateNumber(document.getElementById("statSpent"), "spent", summary.spent);
  }

  function renderCategoryFilter() {
    const used = Array.from(new Set(state.transactions.map((t) => t.category).filter(Boolean)));
    const row = document.getElementById("categoryFilter");
    if (used.length === 0) { row.innerHTML = ""; activeCategory = "all"; return; }
    if (activeCategory !== "all" && !used.includes(activeCategory)) activeCategory = "all";
    const chips = ["all", ...used];
    row.innerHTML = chips.map((c) => `
      <button class="chip ${c === activeCategory ? "active" : ""}" data-chip="${escapeHtml(c)}">
        ${c === "all" ? "All" : `${catMeta(c).icon} ${escapeHtml(c)}`}
      </button>
    `).join("");
  }

  function emptyIllustration(kind) {
    const path = kind === "goals"
      ? '<circle cx="32" cy="32" r="22"/><circle cx="32" cy="32" r="13"/><circle cx="32" cy="32" r="2.5" fill="var(--gold)" stroke="none"/>'
      : '<rect x="16" y="10" width="32" height="44" rx="4"/><path d="M23 22h18M23 30h18M23 38h10"/>';
    return `<svg viewBox="0 0 64 64" width="52" height="52" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--line); display:block; margin:0 auto 10px;">${path}</svg>`;
  }

  function groupLabelFor(dateISO) {
    const today = todayISO();
    const d = new Date(dateISO + "T00:00:00");
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    if (dateISO === today) return "Today";
    if (dateISO === isoDate(yest)) return "Yesterday";
    if (d >= new Date(weekAgo.getFullYear(), weekAgo.getMonth(), weekAgo.getDate())) return "This week";
    return "Earlier";
  }

  function renderTxList() {
    const list = document.getElementById("txList");
    let items = [...state.transactions];
    if (activeCategory !== "all") items = items.filter((t) => t.category === activeCategory);
    const sorted = items.sort((a, b) => (a.date < b.date ? 1 : -1) || b.id.localeCompare(a.id));
    if (sorted.length === 0) {
      const msg = state.transactions.length === 0 ? "No transactions yet. Tap + to add your first one." : "Nothing in this category.";
      list.innerHTML = `<div class="empty-state">${emptyIllustration("tx")}${msg}</div>`;
      return;
    }

    let lastGroup = null;
    let html = "";
    sorted.slice(0, 60).forEach((t) => {
      const group = groupLabelFor(t.date);
      if (group !== lastGroup) {
        html += `<div class="tx-group-label">${group}</div>`;
        lastGroup = group;
      }
      const meta = catMeta(t.category);
      html += `
      <li class="tx-item" data-id="${t.id}">
        <div class="tx-swipe-bg">Delete</div>
        <div class="tx-swipe-inner">
          <span class="cat-badge" style="background:${meta.color}26;">${meta.icon}</span>
          <div class="tx-info">
            <div class="tx-note">${escapeHtml(t.note || (t.type === "income" ? "Income" : "Spending"))}${t.recurringId ? " ↻" : ""}</div>
            <div class="tx-meta">${formatDate(t.date)}${t.category ? `<span class="tx-cat">${escapeHtml(t.category)}</span>` : ""}</div>
          </div>
          <div class="tx-amount ${t.type}">${t.type === "expense" ? "-" : "+"}${fmt(t.amount)}</div>
          <button class="tx-del" data-del="${t.id}" aria-label="Delete">✕</button>
        </div>
      </li>
    `;
    });
    list.innerHTML = html;
  }

  // ---------- Swipe-to-delete ----------
  (function setupSwipeToDelete() {
    const list = document.getElementById("txList");
    let dragEl = null, startX = 0, currentX = 0, dragging = false, txId = null;

    list.addEventListener("pointerdown", (e) => {
      const inner = e.target.closest(".tx-swipe-inner");
      if (!inner) return;
      dragEl = inner;
      txId = inner.closest(".tx-item").dataset.id;
      startX = e.clientX;
      currentX = 0;
      dragging = true;
      dragEl.classList.add("dragging");
      dragEl.setPointerCapture(e.pointerId);
    });

    list.addEventListener("pointermove", (e) => {
      if (!dragging || !dragEl) return;
      currentX = Math.min(0, e.clientX - startX);
      dragEl.style.transform = `translateX(${currentX}px)`;
    });

    function endDrag() {
      if (!dragging || !dragEl) return;
      dragEl.classList.remove("dragging");
      const threshold = -90;
      if (currentX < threshold) {
        const item = dragEl.closest(".tx-item");
        item.style.transition = "opacity .18s ease";
        item.style.opacity = "0";
        setTimeout(() => {
          state.transactions = state.transactions.filter((t) => t.id !== txId);
          save();
          renderAll();
        }, 160);
      } else {
        dragEl.style.transform = "translateX(0)";
      }
      dragging = false;
      dragEl = null;
    }

    list.addEventListener("pointerup", endDrag);
    list.addEventListener("pointercancel", endDrag);
  })();

  function renderRecurring() {
    const list = document.getElementById("recurringList");
    const empty = document.getElementById("recurringEmpty");
    if (state.recurring.length === 0) {
      list.innerHTML = "";
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";
    list.innerHTML = state.recurring.map((r) => `
      <div class="recur-item" data-id="${r.id}">
        <span class="tx-dot ${r.type}"></span>
        <div class="recur-info">
          <div class="recur-note">${escapeHtml(r.note || (r.type === "income" ? "Income" : "Spending"))}</div>
          <div class="recur-meta">${ordinal(r.day)} of each period · ${r.category || "Other"}</div>
        </div>
        <div class="tx-amount ${r.type}">${r.type === "expense" ? "-" : "+"}${fmt(r.amount)}</div>
        <button class="tx-del" data-delrec="${r.id}" aria-label="Delete">✕</button>
      </div>
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
      const complete = g.saved >= g.target && g.target > 0;
      return `
        <div class="goal-card ${complete ? "goal-complete" : ""}" data-id="${g.id}">
          <div class="goal-top">
            <div class="goal-name">${g.icon || "🎯"} ${escapeHtml(g.name)}</div>
            <div class="goal-nums">${fmt(g.saved)} / ${fmt(g.target)}</div>
          </div>
          <div class="goal-bar-track"><div class="goal-bar-fill" style="width:${pct}%"></div></div>
          ${complete ? `<div class="goal-complete-badge">🎉 Goal reached!</div>` : ""}
          <div class="goal-actions">
            <button class="btn btn-secondary btn-sm" data-fund="${g.id}">Add funds</button>
            <button class="btn btn-ghost btn-sm" data-delgoal="${g.id}">Delete</button>
          </div>
        </div>
      `;
    }).join("");
  }

  const revealedWallets = new Set();

  function maskAccountNumber(num) {
    const digits = String(num).replace(/\s+/g, "");
    if (digits.length <= 4) return digits;
    return `•••• ${digits.slice(-4)}`;
  }

  function renderWalletsPage() {
    animateNumber(document.getElementById("walletPageTotal"), "wallet-page-total", computeTotalBalance());

    const list = document.getElementById("walletDetailList");
    const empty = document.getElementById("walletsEmpty");
    if (state.wallets.length === 0) {
      list.innerHTML = "";
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";
    list.innerHTML = state.wallets.map((w) => {
      const count = state.transactions.filter((t) => t.walletId === w.id).length;
      const acctLine = w.accountNumber
        ? `<div class="wallet-acct" data-reveal="${w.id}"><span class="eye">${revealedWallets.has(w.id) ? "🙈" : "👁️"}</span>${revealedWallets.has(w.id) ? escapeHtml(w.accountNumber) : maskAccountNumber(w.accountNumber)}</div>`
        : "";
      return `
        <div class="wallet-detail-card" data-id="${w.id}">
          <div class="wallet-detail-icon">${w.icon}</div>
          <div class="wallet-detail-info">
            <div class="wallet-detail-name">${escapeHtml(w.name)}</div>
            <div class="wallet-detail-sub">${count} transaction${count === 1 ? "" : "s"}</div>
            ${acctLine}
          </div>
          <div class="wallet-detail-amount">${fmt(computeWalletBalance(w.id))}</div>
          <button class="wallet-detail-del" data-delwallet="${w.id}" aria-label="Delete wallet">✕</button>
        </div>
      `;
    }).join("");
  }

  function populateWalletSelects() {
    const options = state.wallets.map((w) => `<option value="${w.id}">${w.icon} ${escapeHtml(w.name)}</option>`).join("");
    ["txWallet", "addFundsWallet"].forEach((id) => {
      const sel = document.getElementById(id);
      const prev = sel.value;
      sel.innerHTML = options;
      if (state.wallets.some((w) => w.id === prev)) sel.value = prev;
    });
  }

  function renderSettings() {
    document.getElementById("currencyInput").value = state.settings.currency;
    document.getElementById("incomeInput").value = state.settings.monthlyIncome || "";
    document.getElementById("warnToggle").checked = !!state.settings.warnEnabled;
    document.getElementById("warnThreshold").value = state.settings.warnThreshold;
    document.getElementById("themeToggle").checked = state.settings.theme === "light";
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
    refreshAppLockSetting();
  }

  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function populateCategorySelect() {
    const sel = document.getElementById("txCategory");
    if (sel.options.length) return;
    sel.innerHTML = CATEGORIES.map((c) => `<option value="${c}">${catMeta(c).icon} ${c}</option>`).join("");
  }

  function renderWeekChart() {
    const svg = document.getElementById("weekChart");
    const labelsEl = document.getElementById("weekChartLabels");
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      days.push(d);
    }
    const totals = days.map((d) => {
      const iso = isoDate(d);
      return state.transactions
        .filter((t) => t.type === "expense" && t.date === iso)
        .reduce((s, t) => s + t.amount, 0);
    });
    const max = Math.max(...totals, 1);
    const barW = 28, gap = (320 - barW * 7) / 8, chartH = 90;

    let bars = "";
    totals.forEach((val, i) => {
      const h = Math.max((val / max) * (chartH - 14), val > 0 ? 4 : 0);
      const x = gap + i * (barW + gap);
      const y = chartH - h;
      const isToday = i === 6;
      bars += `<rect class="chart-bar${isToday ? " today" : ""}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" rx="5"></rect>`;
    });
    svg.innerHTML = bars;

    labelsEl.innerHTML = days.map((d) => `<span>${d.toLocaleDateString(undefined, { weekday: "narrow" })}</span>`).join("");
  }

  function renderAll() {
    const summary = computeSummary();
    renderGreeting();
    renderMonthLabel(summary.period);
    renderWallets();
    renderWalletsPage();
    renderDialTicks();
    renderDial(summary);
    renderStats(summary);
    renderWeekChart();
    renderCategoryFilter();
    renderTxList();
    renderGoals();
    renderRecurring();
    renderSettings();
    populateCategorySelect();
    populateWalletSelects();
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
    document.getElementById("txRecurring").checked = false;
    populateCategorySelect();
    populateWalletSelects();
    document.getElementById("txCategory").value = CATEGORIES[0];
    if (defaultWalletId()) document.getElementById("txWallet").value = defaultWalletId();
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
    const category = document.getElementById("txCategory").value;
    const walletId = document.getElementById("txWallet").value || defaultWalletId();
    const date = document.getElementById("txDate").value || todayISO();
    const isRecurring = document.getElementById("txRecurring").checked;

    if (isRecurring) {
      const recId = uid();
      const day = new Date(date + "T00:00:00").getDate();
      const periodStartISO = isoDate(currentPeriod().start);
      state.recurring.push({ id: recId, type: currentTxType, amount, note, category, day, walletId, lastPeriodStart: periodStartISO });
      state.transactions.push({ id: uid(), type: currentTxType, amount, note, category, date, walletId, recurringId: recId });
    } else {
      state.transactions.push({ id: uid(), type: currentTxType, amount, note, category, date, walletId });
    }

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

  document.getElementById("categoryFilter").addEventListener("click", (e) => {
    const chip = e.target.getAttribute("data-chip");
    if (chip) {
      activeCategory = chip;
      renderCategoryFilter();
      renderTxList();
    }
  });

  document.getElementById("recurringList").addEventListener("click", (e) => {
    const delId = e.target.getAttribute("data-delrec");
    if (delId) {
      state.recurring = state.recurring.filter((r) => r.id !== delId);
      save();
      renderAll();
    }
  });

  // ---------- Goals ----------
  const GOAL_EMOJIS = ["🎯", "🏖️", "🏠", "🚗", "🎧", "💻", "✈️", "🎓", "💍", "🐣", "🎁", "🩺"];
  let selectedGoalEmoji = GOAL_EMOJIS[0];

  function renderGoalEmojiPicker() {
    const el = document.getElementById("goalEmojiPicker");
    el.innerHTML = GOAL_EMOJIS.map((e) => `
      <div class="emoji-opt ${e === selectedGoalEmoji ? "active" : ""}" data-emoji="${e}">${e}</div>
    `).join("");
  }
  document.getElementById("goalEmojiPicker").addEventListener("click", (e) => {
    const opt = e.target.closest(".emoji-opt");
    if (!opt) return;
    selectedGoalEmoji = opt.dataset.emoji;
    renderGoalEmojiPicker();
  });

  const goalBackdrop = document.getElementById("goalBackdrop");
  document.getElementById("newGoalBtn").addEventListener("click", () => {
    document.getElementById("goalName").value = "";
    document.getElementById("goalTarget").value = "";
    selectedGoalEmoji = GOAL_EMOJIS[0];
    renderGoalEmojiPicker();
    goalBackdrop.classList.add("show");
  });
  document.getElementById("goalCancel").addEventListener("click", () => goalBackdrop.classList.remove("show"));
  goalBackdrop.addEventListener("click", (e) => { if (e.target === goalBackdrop) goalBackdrop.classList.remove("show"); });

  document.getElementById("goalSave").addEventListener("click", () => {
    const name = document.getElementById("goalName").value.trim();
    const target = parseFloat(document.getElementById("goalTarget").value);
    if (!name || !target || target <= 0) return;
    state.goals.push({ id: uid(), name, target, saved: 0, icon: selectedGoalEmoji });
    save();
    goalBackdrop.classList.remove("show");
    renderAll();
  });

  // ---------- Wallets ----------
  let selectedWalletEmoji = WALLET_ICONS[0];
  let editingWalletId = null;
  const walletBackdrop = document.getElementById("walletBackdrop");

  function renderWalletEmojiPicker() {
    const el = document.getElementById("walletEmojiPicker");
    el.innerHTML = WALLET_ICONS.map((e) => `
      <div class="emoji-opt ${e === selectedWalletEmoji ? "active" : ""}" data-emoji="${e}">${e}</div>
    `).join("");
  }
  document.getElementById("walletEmojiPicker").addEventListener("click", (e) => {
    const opt = e.target.closest(".emoji-opt");
    if (!opt) return;
    selectedWalletEmoji = opt.dataset.emoji;
    renderWalletEmojiPicker();
  });

  document.getElementById("newWalletBtn").addEventListener("click", () => {
    editingWalletId = null;
    document.getElementById("walletSheetTitle").textContent = "New wallet";
    document.getElementById("walletName").value = "";
    document.getElementById("walletBalance").value = "";
    document.getElementById("walletAccountNumber").value = "";
    selectedWalletEmoji = WALLET_ICONS[0];
    renderWalletEmojiPicker();
    walletBackdrop.classList.add("show");
  });
  document.getElementById("walletCancel").addEventListener("click", () => walletBackdrop.classList.remove("show"));
  walletBackdrop.addEventListener("click", (e) => { if (e.target === walletBackdrop) walletBackdrop.classList.remove("show"); });

  document.getElementById("walletSave").addEventListener("click", () => {
    const name = document.getElementById("walletName").value.trim();
    const startingBalance = parseFloat(document.getElementById("walletBalance").value) || 0;
    const accountNumber = document.getElementById("walletAccountNumber").value.trim();
    if (!name) return;

    if (editingWalletId) {
      const w = state.wallets.find((x) => x.id === editingWalletId);
      if (w) {
        w.name = name;
        w.icon = selectedWalletEmoji;
        w.startingBalance = startingBalance;
        w.accountNumber = accountNumber || undefined;
      }
    } else {
      state.wallets.push({ id: uid(), name, icon: selectedWalletEmoji, startingBalance, accountNumber: accountNumber || undefined });
    }
    save();
    walletBackdrop.classList.remove("show");
    renderAll();
  });

  document.getElementById("walletDetailList").addEventListener("click", (e) => {
    const delId = e.target.getAttribute("data-delwallet");
    const revealId = e.target.closest("[data-reveal]") ? e.target.closest("[data-reveal]").dataset.reveal : null;

    if (delId) {
      if (state.wallets.length <= 1) {
        alert("You need at least one wallet. Add another before deleting this one.");
        return;
      }
      if (!confirm("Delete this wallet? Its transactions will move to your other wallet.")) return;
      state.wallets = state.wallets.filter((w) => w.id !== delId);
      const fallbackId = defaultWalletId();
      state.transactions.forEach((t) => { if (t.walletId === delId) t.walletId = fallbackId; });
      state.recurring.forEach((r) => { if (r.walletId === delId) r.walletId = fallbackId; });
      save();
      renderAll();
      return;
    }

    if (revealId) {
      if (revealedWallets.has(revealId)) revealedWallets.delete(revealId);
      else revealedWallets.add(revealId);
      renderWalletsPage();
      return;
    }

    // Tapping elsewhere on the card opens it for editing.
    const card = e.target.closest(".wallet-detail-card");
    if (card) {
      const w = state.wallets.find((x) => x.id === card.dataset.id);
      if (!w) return;
      editingWalletId = w.id;
      document.getElementById("walletSheetTitle").textContent = "Edit wallet";
      document.getElementById("walletName").value = w.name;
      document.getElementById("walletBalance").value = w.startingBalance || "";
      document.getElementById("walletAccountNumber").value = w.accountNumber || "";
      selectedWalletEmoji = w.icon;
      renderWalletEmojiPicker();
      walletBackdrop.classList.add("show");
    }
  });

  document.getElementById("walletRow").addEventListener("click", () => {
    document.querySelector('.tab-btn[data-view="wallet"]').click();
  });

  const addFundsBackdrop = document.getElementById("addFundsBackdrop");
  let fundingGoalId = null;

  document.getElementById("goalsList").addEventListener("click", (e) => {
    const fundId = e.target.getAttribute("data-fund");
    const delId = e.target.getAttribute("data-delgoal");
    if (fundId) {
      fundingGoalId = fundId;
      document.getElementById("addFundsAmount").value = "";
      populateWalletSelects();
      if (defaultWalletId()) document.getElementById("addFundsWallet").value = defaultWalletId();
      addFundsBackdrop.classList.add("show");
    } else if (delId) {
      state.goals = state.goals.filter((g) => g.id !== delId);
      save();
      renderAll();
    }
  });

  document.getElementById("addFundsCancel").addEventListener("click", () => addFundsBackdrop.classList.remove("show"));
  addFundsBackdrop.addEventListener("click", (e) => { if (e.target === addFundsBackdrop) addFundsBackdrop.classList.remove("show"); });

  function fireConfetti() {
    const colors = ["#e8b14e", "#2aa198", "#e8735c", "#7CB86A", "#A87CE0"];
    const count = 24;
    for (let i = 0; i < count; i++) {
      const piece = document.createElement("div");
      piece.className = "confetti-piece";
      piece.style.left = Math.random() * 100 + "vw";
      piece.style.background = colors[i % colors.length];
      const duration = 1.4 + Math.random() * 0.9;
      piece.style.animationDuration = duration + "s";
      piece.style.animationDelay = (Math.random() * 0.3) + "s";
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), (duration + 0.3) * 1000);
    }
  }

  document.getElementById("addFundsSave").addEventListener("click", () => {
    const amount = parseFloat(document.getElementById("addFundsAmount").value);
    if (!amount || amount <= 0 || !fundingGoalId) return;
    const walletId = document.getElementById("addFundsWallet").value || defaultWalletId();
    const goal = state.goals.find((g) => g.id === fundingGoalId);
    if (goal) {
      const wasComplete = goal.target > 0 && goal.saved >= goal.target;
      goal.saved += amount;
      const nowComplete = goal.target > 0 && goal.saved >= goal.target;
      // Also log it as an expense so it affects the daily allowance honestly.
      state.transactions.push({ id: uid(), type: "expense", amount, note: `To goal: ${goal.name}`, category: "Other", date: todayISO(), walletId });
      save();
      if (!wasComplete && nowComplete) fireConfetti();
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
  document.getElementById("themeToggle").addEventListener("change", (e) => {
    state.settings.theme = e.target.checked ? "light" : "dark";
    save(); applyTheme();
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

  // ---------- App lock (biometric via WebAuthn) ----------
  document.getElementById("resetBtn").addEventListener("click", () => {
    if (confirm("This erases all transactions, goals and settings on this device. Continue?")) {
      state = defaultState();
      save();
      renderAll();
    }
  });

  const LOCK_KEY = "pockets:lock";

  function getLockConfig() {
    try { return JSON.parse(localStorage.getItem(LOCK_KEY) || "null"); }
    catch (e) { return null; }
  }
  function setLockConfig(cfg) {
    if (cfg) localStorage.setItem(LOCK_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(LOCK_KEY);
  }

  function bufToBase64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  }
  function base64ToBuf(b64) {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  }
  function randomBytes(len) {
    return crypto.getRandomValues(new Uint8Array(len));
  }

  async function biometricSupported() {
    if (!window.PublicKeyCredential || !navigator.credentials) return false;
    try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
    catch (e) { return false; }
  }

  async function enrollBiometric() {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: "Pockets", id: location.hostname },
        user: { id: randomBytes(16), name: "pockets-user", displayName: "Pockets" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
        timeout: 60000,
      },
    });
    return bufToBase64(cred.rawId);
  }

  async function verifyBiometric(credentialIdB64) {
    await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ id: base64ToBuf(credentialIdB64), type: "public-key", transports: ["internal"] }],
        userVerification: "required",
        timeout: 60000,
      },
    });
    return true; // resolves only if the OS confirms the biometric check
  }

  async function refreshAppLockSetting() {
    const supported = await biometricSupported();
    const toggle = document.getElementById("appLockToggle");
    const sub = document.getElementById("appLockSub");
    const cfg = getLockConfig();
    toggle.checked = !!(cfg && cfg.enabled);
    if (!supported) {
      toggle.disabled = true;
      sub.textContent = "Not supported on this browser/device";
    } else {
      toggle.disabled = false;
      sub.textContent = "Require fingerprint/Face ID to open Pockets";
    }
  }

  document.getElementById("appLockToggle").addEventListener("change", async (e) => {
    const wantOn = e.target.checked;
    if (wantOn) {
      try {
        const credentialId = await enrollBiometric();
        setLockConfig({ enabled: true, credentialId });
      } catch (err) {
        console.warn("Biometric enrollment failed", err);
        e.target.checked = false;
        alert("Couldn't set up the fingerprint/Face ID lock. Make sure one is enrolled in your phone's settings, then try again.");
      }
    } else {
      setLockConfig(null);
    }
  });

  document.getElementById("unlockBtn").addEventListener("click", async () => {
    const cfg = getLockConfig();
    const sub = document.getElementById("lockSub");
    if (!cfg || !cfg.credentialId) { hideLockOverlay(); return; }
    try {
      await verifyBiometric(cfg.credentialId);
      hideLockOverlay();
    } catch (err) {
      sub.textContent = "That didn't work — tap Unlock to try again.";
    }
  });

  document.getElementById("lockResetBtn").addEventListener("click", () => {
    if (confirm("This turns off the app lock so you can get back in. Your transactions and goals are not affected. Continue?")) {
      setLockConfig(null);
      hideLockOverlay();
    }
  });

  function hideLockOverlay() {
    document.getElementById("lockOverlay").classList.remove("show");
    boot();
  }

  function boot() {
    applyTheme();
    processRecurring();
    renderAll();
  }

  // ---------- Service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW registration failed", err));
    });
  }

  const lockCfg = getLockConfig();
  if (lockCfg && lockCfg.enabled && lockCfg.credentialId) {
    document.getElementById("lockOverlay").classList.add("show");
    applyTheme(); // so the lock screen itself respects light/dark mode
  } else {
    boot();
  }
})();

