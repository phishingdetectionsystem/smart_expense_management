
/* =========================================
   SMARTSPEND - MAIN JAVASCRIPT
   GSAP SLIDING NAVIGATION INCLUDED
========================================= */

const API_URL = "/api";

let expenses = [];
let incomes = [];
let analyticsData = {};
let currentReport = null;

let charts = {
    pie: [],
    bar: [],
    daily: null,
    monthly: null
};

let toastTimer;


/* =========================================
   DOM ELEMENTS
========================================= */

const authScreen = document.getElementById("auth-screen");
const appShell = document.getElementById("app-shell");

const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");

const loginPanel = document.getElementById("login-panel");
const registerPanel = document.getElementById("register-panel");

const loginMessage = document.getElementById("login-message");
const registerMessage = document.getElementById("register-message");

const expenseForm = document.getElementById("expense-form");
const incomeForm = document.getElementById("income-form");
const editForm = document.getElementById("edit-expense-form");

const expenseList = document.getElementById("expense-list");
const incomeList = document.getElementById("income-list");

const searchInput = document.getElementById("search-input");

const editModal = document.getElementById("edit-modal");

const toast = document.getElementById("toast");
const toastMessage = document.getElementById("toast-message");

const sidebar = document.getElementById("sidebar");
const menuToggle = document.getElementById("menu-toggle");

const sidebarNav = document.querySelector(".sidebar-nav");
const navIndicator = document.querySelector(".nav-indicator");

let navResizeFrame = null;


/* =========================================
   HELPER FUNCTIONS
========================================= */

function formatCurrency(value) {
    const amount = Number(value) || 0;

    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2
    }).format(amount);
}


function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => {
        const replacements = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        };

        return replacements[character];
    });
}


function todayString() {
    const date = new Date();

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}


function showMessage(element, message, type = "error") {
    if (!element) return;

    element.textContent = message;
    element.classList.remove("success");

    if (type === "success") {
        element.classList.add("success");
    }
}


function clearMessage(element) {
    if (!element) return;

    element.textContent = "";
    element.classList.remove("success");
}


function showToast(message, type = "success") {
    if (!toast || !toastMessage) return;

    clearTimeout(toastTimer);

    toastMessage.textContent = message;

    toast.classList.remove("show", "success", "error");
    toast.classList.add(type);

    requestAnimationFrame(() => {
        toast.classList.add("show");
    });

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}


async function apiRequest(url, options = {}) {
    const settings = {
        credentials: "same-origin",
        ...options,
        headers: {
            ...(options.headers || {})
        }
    };

    if (settings.body && typeof settings.body !== "string") {
        settings.headers["Content-Type"] = "application/json";
        settings.body = JSON.stringify(settings.body);
    }

    const response = await fetch(url, settings);

    const contentType = response.headers.get("content-type") || "";

    let result = {};

    if (contentType.includes("application/json")) {
        result = await response.json();
    } else if (!response.ok) {
        result = {
            error: "Something went wrong. Please try again."
        };
    }

    if (response.status === 401) {
        showLoginScreen();
        throw new Error(result.error || "Please login again.");
    }

    if (!response.ok) {
        throw new Error(
            result.error || result.message || "Request failed."
        );
    }

    return result;
}


/* =========================================
   AUTHENTICATION
========================================= */

function showLoginScreen() {
    authScreen.hidden = false;
    appShell.hidden = true;

    loginPanel.hidden = false;
    registerPanel.hidden = true;

    loginForm.reset();
    registerForm.reset();

    clearMessage(loginMessage);
    clearMessage(registerMessage);
}


function showRegisterScreen() {
    loginPanel.hidden = true;
    registerPanel.hidden = false;

    clearMessage(loginMessage);
    clearMessage(registerMessage);
}


function showApplication(user) {
    authScreen.hidden = true;
    appShell.hidden = false;

    const nameElement = document.getElementById("user-name");
    const emailElement = document.getElementById("user-email");
    const avatarElement = document.querySelector(".user-avatar");

    if (nameElement) {
        nameElement.textContent = user.name || "User";
    }

    if (emailElement) {
        emailElement.textContent = user.email || "";
    }

    if (avatarElement) {
        avatarElement.textContent =
            (user.name || "U").charAt(0).toUpperCase();
    }

    initializeDates();

    // Position the navigation pill after the app becomes visible.
    requestAnimationFrame(() => {
        initializeNavIndicator();
    });

    loadApplicationData();
}


document.getElementById("show-register").addEventListener("click", () => {
    showRegisterScreen();
});


document.getElementById("show-login").addEventListener("click", () => {
    showLoginScreen();
});


loginForm.addEventListener("submit", async event => {
    event.preventDefault();

    clearMessage(loginMessage);

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    try {
        const result = await apiRequest(`${API_URL}/auth/login`, {
            method: "POST",
            body: { email, password }
        });

        showToast(result.message || "Login successful.");

        const user = await apiRequest(`${API_URL}/auth/me`);

        showApplication(user);

    } catch (error) {
        showMessage(loginMessage, error.message);
    }
});


registerForm.addEventListener("submit", async event => {
    event.preventDefault();

    clearMessage(registerMessage);

    const name = document.getElementById("register-name").value.trim();
    const email = document.getElementById("register-email").value.trim();
    const password = document.getElementById("register-password").value;

    if (password.length < 8) {
        showMessage(
            registerMessage,
            "Password must contain at least 8 characters."
        );
        return;
    }

    try {
        const result = await apiRequest(`${API_URL}/auth/register`, {
            method: "POST",
            body: { name, email, password }
        });

        showToast(result.message || "Account created successfully.");

        const user = await apiRequest(`${API_URL}/auth/me`);

        showApplication(user);

    } catch (error) {
        showMessage(registerMessage, error.message);
    }
});


document.getElementById("logout-btn").addEventListener("click", async () => {
    const confirmed = confirm("Are you sure you want to logout?");

    if (!confirmed) return;

    try {
        const result = await apiRequest(`${API_URL}/auth/logout`, {
            method: "POST"
        });

        expenses = [];
        incomes = [];

        showLoginScreen();

        showToast(result.message || "Logged out successfully.");

    } catch (error) {
        showToast(error.message, "error");
    }
});


async function checkLogin() {
    try {
        const user = await apiRequest(`${API_URL}/auth/me`);

        if (user.logged_in) {
            showApplication(user);
        } else {
            showLoginScreen();
        }

    } catch (error) {
        showLoginScreen();
    }
}


/* =========================================
   INITIALIZE DATES
========================================= */

function initializeDates() {
    const today = todayString();

    const expenseDate = document.getElementById("expense-date");
    const incomeDate = document.getElementById("income-date");

    if (expenseDate && !expenseDate.value) {
        expenseDate.value = today;
    }

    if (incomeDate && !incomeDate.value) {
        incomeDate.value = today;
    }

    const reportYear = document.getElementById("report-year");
    const reportMonth = document.getElementById("report-month");

    if (reportYear && !reportYear.value) {
        reportYear.value = new Date().getFullYear();
    }

    if (reportMonth) {
        reportMonth.value = String(new Date().getMonth() + 1);
    }
}


/* =========================================
   LOAD APPLICATION DATA
========================================= */

async function loadApplicationData() {
    try {
        await Promise.all([
            loadExpenses(),
            loadIncomes(),
            loadAnalytics()
        ]);

    } catch (error) {
        console.error("Application loading error:", error);
        showToast(error.message, "error");
    }
}


/* =========================================
   EXPENSE MANAGEMENT
========================================= */

async function loadExpenses() {
    const result = await apiRequest(`${API_URL}/expenses`);

    expenses = Array.isArray(result)
        ? result
        : result.expenses || [];

    renderExpenses();
    renderRecentExpenses();
    updateDashboard();
    updateCategoryCharts();
}


function renderExpenses() {
    if (!expenseList) return;

    const searchText = searchInput
        ? searchInput.value.toLowerCase().trim()
        : "";

    const filteredExpenses = expenses.filter(expense => {
        const searchableText = [
            expense.title,
            expense.category,
            expense.description,
            expense.expense_date
        ].join(" ").toLowerCase();

        return searchableText.includes(searchText);
    });

    if (filteredExpenses.length === 0) {
        expenseList.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    No matching expenses found.
                </td>
            </tr>
        `;
        return;
    }

    expenseList.innerHTML = filteredExpenses.map(expense => `
        <tr>
            <td><strong>${escapeHTML(expense.title)}</strong></td>

            <td>
                <span class="category-badge">
                    ${escapeHTML(expense.category)}
                </span>
            </td>

            <td>${escapeHTML(expense.expense_date)}</td>

            <td><strong>${formatCurrency(expense.amount)}</strong></td>

            <td>${escapeHTML(expense.description || "-")}</td>

            <td>
                <div class="table-action">
                    <button
                        type="button"
                        class="action-btn"
                        data-action="edit"
                        data-id="${Number(expense.id)}"
                    >Edit</button>

                    <button
                        type="button"
                        class="action-btn delete"
                        data-action="delete"
                        data-id="${Number(expense.id)}"
                    >Delete</button>
                </div>
            </td>
        </tr>
    `).join("");
}


function renderRecentExpenses() {
    const recentList = document.getElementById("recent-expense-list");

    if (!recentList) return;

    const recentExpenses = [...expenses]
        .sort((a, b) => {
            return String(b.expense_date).localeCompare(
                String(a.expense_date)
            );
        })
        .slice(0, 5);

    if (recentExpenses.length === 0) {
        recentList.innerHTML = `
            <tr>
                <td colspan="4" class="empty-state">
                    No expenses available.
                </td>
            </tr>
        `;
        return;
    }

    recentList.innerHTML = recentExpenses.map(expense => `
        <tr>
            <td><strong>${escapeHTML(expense.title)}</strong></td>

            <td>
                <span class="category-badge">
                    ${escapeHTML(expense.category)}
                </span>
            </td>

            <td>${escapeHTML(expense.expense_date)}</td>

            <td><strong>${formatCurrency(expense.amount)}</strong></td>
        </tr>
    `).join("");
}


if (searchInput) {
    searchInput.addEventListener("input", renderExpenses);
}


expenseForm.addEventListener("submit", async event => {
    event.preventDefault();

    const message = document.getElementById("form-message");

    clearMessage(message);

    const expense = {
        title: document.getElementById("title").value.trim(),
        amount: Number(document.getElementById("amount").value),
        category: document.getElementById("category").value,
        expense_date: document.getElementById("expense-date").value,
        description: document.getElementById("description").value.trim()
    };

    try {
        const result = await apiRequest(`${API_URL}/expenses`, {
            method: "POST",
            body: expense
        });

        expenseForm.reset();
        initializeDates();

        await loadExpenses();
        await loadAnalytics();

        showMessage(
            message,
            result.message || "Expense added successfully.",
            "success"
        );

        showToast("Expense added successfully.");

    } catch (error) {
        showMessage(message, error.message);
    }
});


/* =========================================
   EDIT EXPENSE
========================================= */

function openEditModal(id) {
    const expense = expenses.find(
        item => Number(item.id) === Number(id)
    );

    if (!expense) {
        showToast("Expense not found.", "error");
        return;
    }

    document.getElementById("edit-id").value = expense.id;
    document.getElementById("edit-title").value = expense.title;
    document.getElementById("edit-amount").value = expense.amount;
    document.getElementById("edit-category").value = expense.category;
    document.getElementById("edit-date").value = expense.expense_date;
    document.getElementById("edit-description").value =
        expense.description || "";

    clearMessage(document.getElementById("edit-message"));

    editModal.hidden = false;
}


function closeEditModal() {
    editModal.hidden = true;
}


document.getElementById("close-modal").addEventListener(
    "click",
    closeEditModal
);


document.getElementById("cancel-edit").addEventListener(
    "click",
    closeEditModal
);


const modalOverlay = document.getElementById("modal-overlay");

if (modalOverlay) {
    modalOverlay.addEventListener("click", closeEditModal);
}


editForm.addEventListener("submit", async event => {
    event.preventDefault();

    const id = document.getElementById("edit-id").value;

    const expense = {
        title: document.getElementById("edit-title").value.trim(),
        amount: Number(document.getElementById("edit-amount").value),
        category: document.getElementById("edit-category").value,
        expense_date: document.getElementById("edit-date").value,
        description: document.getElementById("edit-description").value.trim()
    };

    const message = document.getElementById("edit-message");

    clearMessage(message);

    try {
        const result = await apiRequest(`${API_URL}/expenses/${id}`, {
            method: "PUT",
            body: expense
        });

        closeEditModal();

        await loadExpenses();
        await loadAnalytics();

        showToast(result.message || "Expense updated successfully.");

    } catch (error) {
        showMessage(message, error.message);
    }
});


/* =========================================
   DELETE EXPENSE
========================================= */

async function deleteExpense(id) {
    const confirmed = confirm(
        "Are you sure you want to delete this expense?"
    );

    if (!confirmed) return;

    try {
        const result = await apiRequest(`${API_URL}/expenses/${id}`, {
            method: "DELETE"
        });

        await loadExpenses();
        await loadAnalytics();

        showToast(result.message || "Expense deleted successfully.");

    } catch (error) {
        showToast(error.message, "error");
    }
}


if (expenseList) {
    expenseList.addEventListener("click", event => {
        const button = event.target.closest("button[data-action]");

        if (!button) return;

        const id = Number(button.dataset.id);

        if (button.dataset.action === "edit") {
            openEditModal(id);
        }

        if (button.dataset.action === "delete") {
            deleteExpense(id);
        }
    });
}


/* =========================================
   INCOME MANAGEMENT
========================================= */

async function loadIncomes() {
    const result = await apiRequest(`${API_URL}/income`);

    incomes = Array.isArray(result)
        ? result
        : result.incomes || [];

    renderIncomes();
}


function renderIncomes() {
    if (!incomeList) return;

    if (incomes.length === 0) {
        incomeList.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state">
                    No income records available.
                </td>
            </tr>
        `;
        return;
    }

    const sortedIncomes = [...incomes].sort((a, b) => {
        return String(b.income_date).localeCompare(
            String(a.income_date)
        );
    });

    incomeList.innerHTML = sortedIncomes.map(income => `
        <tr>
            <td><strong>${escapeHTML(income.title)}</strong></td>

            <td>${escapeHTML(income.income_date)}</td>

            <td>${escapeHTML(income.description || "-")}</td>

            <td><strong>${formatCurrency(income.amount)}</strong></td>

            <td>
                <button
                    type="button"
                    class="action-btn delete"
                    data-income-delete="${Number(income.id)}"
                >Delete</button>
            </td>
        </tr>
    `).join("");
}


incomeForm.addEventListener("submit", async event => {
    event.preventDefault();

    const message = document.getElementById("income-message");

    clearMessage(message);

    const income = {
        title: document.getElementById("income-title").value.trim(),
        amount: Number(document.getElementById("income-amount").value),
        income_date: document.getElementById("income-date").value,
        description: document.getElementById("income-description").value.trim()
    };

    try {
        const result = await apiRequest(`${API_URL}/income`, {
            method: "POST",
            body: income
        });

        incomeForm.reset();
        initializeDates();

        await loadIncomes();
        await loadAnalytics();

        showMessage(
            message,
            result.message || "Income added successfully.",
            "success"
        );

        showToast("Income added successfully.");

    } catch (error) {
        showMessage(message, error.message);
    }
});


if (incomeList) {
    incomeList.addEventListener("click", async event => {
        const button = event.target.closest("[data-income-delete]");

        if (!button) return;

        const id = Number(button.dataset.incomeDelete);

        if (!confirm("Are you sure you want to delete this income record?")) {
            return;
        }

        try {
            const result = await apiRequest(`${API_URL}/income/${id}`, {
                method: "DELETE"
            });

            await loadIncomes();
            await loadAnalytics();

            showToast(result.message || "Income deleted successfully.");

        } catch (error) {
            showToast(error.message, "error");
        }
    });
}


/* =========================================
   DASHBOARD
========================================= */

function updateDashboard() {
    const totalExpenses = expenses.reduce(
        (sum, expense) => sum + Number(expense.amount || 0),
        0
    );

    const currentMonth = todayString().slice(0, 7);

    const monthlyExpenses = expenses
        .filter(expense =>
            String(expense.expense_date).startsWith(currentMonth)
        )
        .reduce(
            (sum, expense) => sum + Number(expense.amount || 0),
            0
        );

    const totalElement = document.getElementById("total-expenses");
    const monthlyElement = document.getElementById("monthly-expenses");
    const transactionsElement = document.getElementById("total-transactions");

    if (totalElement) {
        totalElement.textContent = formatCurrency(totalExpenses);
    }

    if (monthlyElement) {
        monthlyElement.textContent = formatCurrency(monthlyExpenses);
    }

    if (transactionsElement) {
        transactionsElement.textContent = expenses.length;
    }

    renderRecentExpenses();
}


/* =========================================
   ANALYTICS
========================================= */

async function loadAnalytics() {
    analyticsData = await apiRequest(`${API_URL}/analytics`);

    updateAnalyticsDashboard();
    updateTrendCharts();
}


function updateAnalyticsDashboard() {
    const data = analyticsData || {};

    const currentExpenses = Number(data.current_expenses || 0);
    const previousExpenses = Number(data.previous_expenses || 0);
    const currentIncome = Number(data.current_income || 0);

    const savings = Number(
        data.savings ?? (currentIncome - currentExpenses)
    );

    const savingsPercentage = Number(
        data.savings_percentage ??
        (currentIncome > 0 ? (savings / currentIncome) * 100 : 0)
    );

    const currentElement = document.getElementById("current-income");
    const previousElement = document.getElementById("previous-month-expenses");
    const changeElement = document.getElementById("monthly-change");
    const highestElement = document.getElementById("highest-category");
    const savingsElement = document.getElementById("savings-amount");
    const savingsPercentageElement =
        document.getElementById("savings-percentage");

    if (currentElement) {
        currentElement.textContent = formatCurrency(currentIncome);
    }

    if (previousElement) {
        previousElement.textContent = formatCurrency(previousExpenses);
    }

    if (changeElement) {
        if (previousExpenses > 0) {
            const change =
                ((currentExpenses - previousExpenses) / previousExpenses) * 100;

            const prefix = change > 0 ? "+" : "";

            changeElement.textContent = `${prefix}${change.toFixed(1)}%`;
        } else {
            changeElement.textContent =
                currentExpenses > 0 ? "New spending" : "0%";
        }
    }

    let highestCategory = data.highest_category || "--";

    if (typeof highestCategory === "object" && highestCategory !== null) {
        highestCategory =
            highestCategory.category ||
            highestCategory.name ||
            "--";
    }

    if (highestElement) {
        highestElement.textContent = highestCategory;
    }

    if (savingsElement) {
        savingsElement.textContent = formatCurrency(savings);
    }

    if (savingsPercentageElement) {
        savingsPercentageElement.textContent =
            `${savingsPercentage.toFixed(1)}% savings rate`;
    }

    const analyticsIncome = document.getElementById("analytics-income");
    const analyticsExpenses = document.getElementById("analytics-expenses");
    const analyticsSavings = document.getElementById("analytics-savings");

    const analyticsSavingsPercentage =
        document.getElementById("analytics-savings-percentage");

    if (analyticsIncome) {
        analyticsIncome.textContent = formatCurrency(currentIncome);
    }

    if (analyticsExpenses) {
        analyticsExpenses.textContent = formatCurrency(currentExpenses);
    }

    if (analyticsSavings) {
        analyticsSavings.textContent = formatCurrency(savings);
    }

    if (analyticsSavingsPercentage) {
        analyticsSavingsPercentage.textContent =
            `${savingsPercentage.toFixed(1)}%`;
    }
}


/* =========================================
   CHART HELPERS
========================================= */

function chartColors() {
    return [
        "#6558e8",
        "#3989e8",
        "#16a875",
        "#ed9d38",
        "#e65365",
        "#9b59b6",
        "#22a6b3",
        "#8c9eff"
    ];
}


function destroyChart(chart) {
    if (chart) {
        chart.destroy();
    }
}


function getCategoryTotals() {
    const totals = {};

    expenses.forEach(expense => {
        const category = expense.category || "Other";

        totals[category] =
            (totals[category] || 0) + Number(expense.amount || 0);
    });

    return totals;
}


function updateCategoryCharts() {
    if (typeof Chart === "undefined") {
        console.warn("Chart.js is not available.");
        return;
    }

    const totals = getCategoryTotals();

    const labels = Object.keys(totals);
    const values = Object.values(totals);
    const colors = chartColors();

    // The dashboard and analytics sections each contain category charts.
    document.querySelectorAll("#category-pie-chart").forEach(canvas => {
        const existing = Chart.getChart(canvas);

        if (existing) {
            existing.destroy();
        }

        charts.pie.push(new Chart(canvas, {
            type: "doughnut",

            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors,
                    borderWidth: 0,
                    hoverOffset: 8
                }]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,

                plugins: {
                    legend: {
                        position: "bottom"
                    }
                },

                cutout: "62%"
            }
        }));
    });


    document.querySelectorAll("#category-bar-chart").forEach(canvas => {
        const existing = Chart.getChart(canvas);

        if (existing) {
            existing.destroy();
        }

        charts.bar.push(new Chart(canvas, {
            type: "bar",

            data: {
                labels: labels,
                datasets: [{
                    label: "Expenses",
                    data: values,
                    backgroundColor: colors,
                    borderRadius: 7
                }]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,

                plugins: {
                    legend: {
                        display: false
                    }
                },

                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: value => "₹" + value
                        }
                    }
                }
            }
        }));
    });
}


function updateTrendCharts() {
    if (typeof Chart === "undefined") return;

    const dailyCanvas = document.getElementById("daily-trend-chart");
    const monthlyCanvas = document.getElementById("monthly-trend-chart");

    const dailyData = analyticsData.daily_trends || [];
    const monthlyData = analyticsData.monthly_trends || [];

    if (dailyCanvas) {
        destroyChart(charts.daily);

        charts.daily = new Chart(dailyCanvas, {
            type: "line",

            data: {
                labels: dailyData.map(item =>
                    item.date || item.day || ""
                ),

                datasets: [{
                    label: "Daily Expenses",

                    data: dailyData.map(item =>
                        Number(item.total || item.amount || 0)
                    ),

                    borderColor: "#6558e8",
                    backgroundColor: "rgba(101, 88, 232, 0.12)",
                    fill: true,
                    tension: 0.35,
                    pointRadius: 3
                }]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,

                plugins: {
                    legend: {
                        display: false
                    }
                },

                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: value => "₹" + value
                        }
                    }
                }
            }
        });
    }


    if (monthlyCanvas) {
        destroyChart(charts.monthly);

        charts.monthly = new Chart(monthlyCanvas, {
            type: "bar",

            data: {
                labels: monthlyData.map(item =>
                    item.month || item.date || ""
                ),

                datasets: [{
                    label: "Monthly Expenses",

                    data: monthlyData.map(item =>
                        Number(item.total || item.amount || 0)
                    ),

                    backgroundColor: "#3989e8",
                    borderRadius: 7
                }]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,

                plugins: {
                    legend: {
                        display: false
                    }
                },

                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: value => "₹" + value
                        }
                    }
                }
            }
        });
    }
}


/* =========================================
   REPORTS
========================================= */

const reportType = document.getElementById("report-type");
const reportMonth = document.getElementById("report-month");
const reportYear = document.getElementById("report-year");
const reportMonthGroup = document.getElementById("report-month-group");


function updateReportFilters() {
    if (!reportType || !reportMonthGroup) return;

    if (reportType.value === "yearly") {
        reportMonthGroup.hidden = true;
    } else {
        reportMonthGroup.hidden = false;
    }
}


reportType.addEventListener("change", updateReportFilters);


function getReportParameters() {
    const year = reportYear.value;

    if (!year || Number(year) < 2000 || Number(year) > 2100) {
        throw new Error("Please enter a valid report year.");
    }

    const params = new URLSearchParams();

    params.set("year", year);

    if (reportType.value === "monthly") {
        params.set("month", reportMonth.value);
    }

    return params;
}


async function generateReport() {
    try {
        const params = getReportParameters();

        const result = await apiRequest(
            `${API_URL}/reports?${params.toString()}`
        );

        currentReport = result;

        renderReport(result);

        showToast("Report generated successfully.");

    } catch (error) {
        showToast(error.message, "error");
    }
}


function renderReport(report) {
    const totalElement = document.getElementById("report-total");
    const countElement = document.getElementById("report-count");
    const categoriesElement = document.getElementById("report-categories");
    const expensesElement = document.getElementById("report-expenses");

    if (totalElement) {
        totalElement.textContent = formatCurrency(report.total_expenses);
    }

    if (countElement) {
        countElement.textContent = report.total_transactions || 0;
    }

    // Category summary
    const categories = report.categories || [];

    if (categoriesElement) {
        if (categories.length === 0) {
            categoriesElement.innerHTML = `
                <p class="empty-state">No category data available.</p>
            `;
        } else {
            categoriesElement.innerHTML = categories.map(item => `
                <div class="category-summary-item">
                    <p>${escapeHTML(item.category)}</p>
                    <h3>${formatCurrency(item.total)}</h3>
                </div>
            `).join("");
        }
    }

    // Expense details
    const reportExpenses = report.expenses || [];

    if (expensesElement) {
        if (reportExpenses.length === 0) {
            expensesElement.innerHTML = `
                <tr>
                    <td colspan="4" class="empty-state">
                        No expenses found for this period.
                    </td>
                </tr>
            `;
        } else {
            expensesElement.innerHTML = reportExpenses.map(expense => `
                <tr>
                    <td>${escapeHTML(expense.title)}</td>
                    <td>${escapeHTML(expense.category)}</td>
                    <td>${escapeHTML(expense.expense_date)}</td>
                    <td><strong>${formatCurrency(expense.amount)}</strong></td>
                </tr>
            `).join("");
        }
    }

    // Yearly monthly breakdown
    const breakdownSection = document.getElementById(
        "report-monthly-breakdown-section"
    );

    const breakdownBody = document.getElementById(
        "report-monthly-breakdown"
    );

    const monthlyTotals = report.monthly_totals || [];

    if (breakdownSection && breakdownBody) {
        if (reportType.value === "yearly") {
            breakdownSection.hidden = false;

            breakdownBody.innerHTML = monthlyTotals.map(item => `
                <tr>
                    <td>${escapeHTML(item.month)}</td>
                    <td><strong>${formatCurrency(item.total)}</strong></td>
                </tr>
            `).join("");

            if (monthlyTotals.length === 0) {
                breakdownBody.innerHTML = `
                    <tr>
                        <td colspan="2" class="empty-state">
                            No monthly data available.
                        </td>
                    </tr>
                `;
            }

        } else {
            breakdownSection.hidden = true;
        }
    }
}


document.getElementById("generate-report").addEventListener(
    "click",
    generateReport
);


document.getElementById("download-pdf").addEventListener("click", () => {
    downloadReport("pdf");
});


document.getElementById("download-excel").addEventListener("click", () => {
    downloadReport("excel");
});


function downloadReport(format) {
    try {
        const params = getReportParameters();

        const url =
            `${API_URL}/reports/${format}?${params.toString()}`;

        window.location.href = url;

    } catch (error) {
        showToast(error.message, "error");
    }
}


/* =========================================
   NAVIGATION + GSAP SLIDING PILL
========================================= */

let activeNavAnimation = null;


/*
   Moves the animated pill to the selected
   navigation button.
*/

function moveNavIndicator(target, immediate = false) {
    if (!target || !navIndicator || !sidebarNav) {
        return;
    }

    /*
       Use element coordinates relative to the
       sidebar navigation container.
    */

    const navRect = sidebarNav.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    const x = targetRect.left - navRect.left;
    const y = targetRect.top - navRect.top;

    const width = targetRect.width;
    const height = targetRect.height;

    // Fallback when GSAP is unavailable.
    if (typeof gsap === "undefined") {
        navIndicator.style.width = `${width}px`;
        navIndicator.style.height = `${height}px`;
        navIndicator.style.transform =
            `translate(${x}px, ${y}px)`;
        navIndicator.style.opacity = "1";
        return;
    }

    // Stop any previous animation.
    if (activeNavAnimation) {
        activeNavAnimation.kill();
    }

    const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
    ).matches;

    const duration = immediate || reducedMotion ? 0 : 0.45;

    activeNavAnimation = gsap.to(navIndicator, {
        x: x,
        y: y,
        width: width,
        height: height,
        opacity: 1,
        duration: duration,
        ease: "power3.out",
        overwrite: true
    });
}


/*
   Initialize the pill using the currently
   active navigation button.
*/

function initializeNavIndicator() {
    if (!sidebarNav || !navIndicator) {
        return;
    }

    const activeLink = sidebarNav.querySelector(
        '.nav-link.active[data-section]'
    );

    if (activeLink) {
        moveNavIndicator(activeLink, true);
    }
}


/*
   Reposition the pill if the screen size changes.
*/

window.addEventListener("resize", () => {
    if (navResizeFrame) {
        cancelAnimationFrame(navResizeFrame);
    }

    navResizeFrame = requestAnimationFrame(() => {
        initializeNavIndicator();
    });
});


/* =========================================
   MOBILE MENU
========================================= */

function closeMobileMenu() {
    if (sidebar) {
        sidebar.classList.remove("open");
    }

    const backdrop = document.querySelector(".sidebar-backdrop");

    if (backdrop) {
        backdrop.classList.remove("show");
    }
}


function openMobileMenu() {
    if (!sidebar) return;

    sidebar.classList.toggle("open");

    let backdrop = document.querySelector(".sidebar-backdrop");

    if (!backdrop) {
        backdrop = document.createElement("div");
        backdrop.className = "sidebar-backdrop";

        document.body.appendChild(backdrop);

        backdrop.addEventListener("click", closeMobileMenu);
    }

    backdrop.classList.toggle(
        "show",
        sidebar.classList.contains("open")
    );

    // Recalculate the active pill after opening the sidebar.
    requestAnimationFrame(() => {
        initializeNavIndicator();
    });
}


if (menuToggle) {
    menuToggle.addEventListener("click", openMobileMenu);
}


/* =========================================
   SHOW SELECTED PAGE
========================================= */

function showSection(sectionId) {
    const target = document.getElementById(sectionId);

    if (!target || !target.classList.contains("page-section")) {
        return;
    }

    // Hide all page sections.
    document.querySelectorAll(".page-section").forEach(section => {
        section.classList.remove("active");
    });

    // Show selected page.
    target.classList.add("active");

    // Update navigation active state.
    document.querySelectorAll(".nav-link[data-section]").forEach(link => {
        link.classList.toggle(
            "active",
            link.dataset.section === sectionId
        );
    });

    // Move the sliding pill.
    const selectedLink = sidebarNav
        ? sidebarNav.querySelector(
            `.nav-link[data-section="${sectionId}"]`
        )
        : null;

    if (selectedLink) {
        moveNavIndicator(selectedLink);
    }

    // Close mobile navigation.
    closeMobileMenu();

    // Scroll to top.
    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });

    // Resize charts after displaying a previously hidden section.
    setTimeout(() => {
        if (typeof Chart !== "undefined") {
            Object.values(Chart.instances || {}).forEach(chart => {
                chart.resize();
            });
        }
    }, 100);
}


/* =========================================
   NAVIGATION BUTTON EVENTS
========================================= */

document.querySelectorAll(".nav-link[data-section]").forEach(link => {
    link.addEventListener("click", () => {
        showSection(link.dataset.section);
    });
});


/* Dashboard buttons and quick navigation. */

document.querySelectorAll("[data-go]").forEach(button => {
    button.addEventListener("click", () => {
        showSection(button.dataset.go);
    });
});


/* =========================================
   LIGHT AND DARK THEME
========================================= */

function applyTheme(theme) {
    document.body.classList.toggle("dark-theme", theme === "dark");

    const themeButton = document.getElementById("theme-toggle");

    if (themeButton) {
        themeButton.textContent = theme === "dark" ? "☀️" : "🌙";
    }
}


function toggleTheme() {
    const currentTheme = document.body.classList.contains("dark-theme")
        ? "dark"
        : "light";

    const newTheme = currentTheme === "dark" ? "light" : "dark";

    localStorage.setItem("smartspend-theme", newTheme);

    applyTheme(newTheme);
}


document.getElementById("theme-toggle").addEventListener(
    "click",
    toggleTheme
);


document.getElementById("sidebar-theme-toggle").addEventListener(
    "click",
    toggleTheme
);


function initializeTheme() {
    const savedTheme = localStorage.getItem("smartspend-theme") || "light";

    applyTheme(savedTheme);
}


/* =========================================
   KEYBOARD SUPPORT
========================================= */

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && editModal && !editModal.hidden) {
        closeEditModal();
    }

    if (
        event.key === "Escape" &&
        sidebar &&
        sidebar.classList.contains("open")
    ) {
        closeMobileMenu();
    }
});


/* =========================================
   APPLICATION START
========================================= */

document.addEventListener("DOMContentLoaded", () => {
    initializeTheme();
    initializeDates();
    updateReportFilters();

    // The app may initially be hidden.
    // showApplication() positions the pill again after login.
    checkLogin();
});
