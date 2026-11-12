
import os
import sqlite3
import secrets
from pathlib import Path
from datetime import datetime
from functools import wraps
from io import BytesIO

from flask import (
    Flask, render_template, request, jsonify,
    send_file, session, redirect, url_for
)
from werkzeug.security import generate_password_hash, check_password_hash

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
)

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter


app = Flask(__name__)

DATABASE = Path(__file__).with_name("expenses.db")
SECRET_FILE = Path(__file__).with_name("secret_key.txt")

if SECRET_FILE.exists():
    secret_key = SECRET_FILE.read_text().strip()
else:
    secret_key = secrets.token_hex(32)
    SECRET_FILE.write_text(secret_key)

app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", secret_key)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

CATEGORIES = [
    "Food", "Transport", "Shopping", "Bills",
    "Education", "Health", "Entertainment", "Other"
]


# ---------------- DATABASE ----------------

def get_db():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db():
    with get_db() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                amount REAL NOT NULL,
                category TEXT NOT NULL,
                expense_date TEXT NOT NULL,
                description TEXT DEFAULT ''
            )
        """)

        columns = [
            row["name"]
            for row in db.execute("PRAGMA table_info(expenses)").fetchall()
        ]

        if "user_id" not in columns:
            db.execute("""
                ALTER TABLE expenses
                ADD COLUMN user_id INTEGER REFERENCES users(id)
            """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS income (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                amount REAL NOT NULL,
                income_date TEXT NOT NULL,
                description TEXT DEFAULT '',
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        """)

        db.execute("""
            CREATE INDEX IF NOT EXISTS idx_expenses_user_date
            ON expenses(user_id, expense_date)
        """)

        db.execute("""
            CREATE INDEX IF NOT EXISTS idx_income_user_date
            ON income(user_id, income_date)
        """)


# ---------------- AUTHENTICATION ----------------

def login_required(function):
    @wraps(function)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "Please log in first."}), 401
        return function(*args, **kwargs)
    return wrapper


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/auth/me")
def current_user():
    if "user_id" not in session:
        return jsonify({"logged_in": False})

    return jsonify({
        "logged_in": True,
        "name": session.get("name"),
        "email": session.get("email")
    })


@app.route("/api/auth/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}

    name = str(data.get("name", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    if not name or len(name) > 80:
        return jsonify({"error": "Enter a valid name."}), 400

    if "@" not in email or len(email) > 120:
        return jsonify({"error": "Enter a valid email address."}), 400

    if len(password) < 8:
        return jsonify({"error": "Password must contain at least 8 characters."}), 400

    try:
        with get_db() as db:
            db.execute("BEGIN IMMEDIATE")

            existing_users = db.execute(
                "SELECT COUNT(*) AS total FROM users"
            ).fetchone()["total"]

            cursor = db.execute("""
                INSERT INTO users (name, email, password)
                VALUES (?, ?, ?)
            """, (
                name,
                email,
                generate_password_hash(password)
            ))

            user_id = cursor.lastrowid

            # Give existing unassigned expenses to the first account only.
            if existing_users == 0:
                db.execute("""
                    UPDATE expenses
                    SET user_id = ?
                    WHERE user_id IS NULL
                """, (user_id,))

        session.clear()
        session["user_id"] = user_id
        session["name"] = name
        session["email"] = email

        return jsonify({"message": "Account created successfully."})

    except sqlite3.IntegrityError:
        return jsonify({"error": "This email is already registered."}), 409


@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}

    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    with get_db() as db:
        user = db.execute(
            "SELECT * FROM users WHERE email = ?",
            (email,)
        ).fetchone()

    if not user or not check_password_hash(user["password"], password):
        return jsonify({"error": "Incorrect email or password."}), 401

    session.clear()
    session["user_id"] = user["id"]
    session["name"] = user["name"]
    session["email"] = user["email"]

    return jsonify({"message": "Login successful."})


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"message": "Logged out successfully."})


# ---------------- VALIDATION ----------------

def validate_transaction(data, categories=None):
    title = str(data.get("title", "")).strip()
    description = str(data.get("description", "")).strip()
    category = str(data.get("category", "")).strip()
    date_value = str(data.get("expense_date", "")).strip()

    try:
        amount = float(data.get("amount"))
    except (TypeError, ValueError):
        raise ValueError("Enter a valid amount.")

    if not title or len(title) > 100:
        raise ValueError("Title must contain 1 to 100 characters.")

    if amount <= 0 or amount != amount or amount == float("inf"):
        raise ValueError("Amount must be a valid positive number.")

    if categories is not None and category not in categories:
        raise ValueError("Select a valid category.")

    if len(description) > 500:
        raise ValueError("Description is too long.")

    try:
        datetime.strptime(date_value, "%Y-%m-%d")
    except ValueError:
        raise ValueError("Enter a valid date.")

    return title, amount, category, date_value, description


# ---------------- EXPENSES ----------------

@app.route("/api/expenses", methods=["GET", "POST"])
@login_required
def expenses_api():
    user_id = session["user_id"]

    if request.method == "GET":
        with get_db() as db:
            rows = db.execute("""
                SELECT id, title, amount, category,
                       expense_date, description
                FROM expenses
                WHERE user_id = ?
                ORDER BY expense_date DESC, id DESC
            """, (user_id,)).fetchall()

        return jsonify([dict(row) for row in rows])

    data = request.get_json(silent=True) or {}

    try:
        title, amount, category, date_value, description = (
            validate_transaction(data, CATEGORIES)
        )

        with get_db() as db:
            db.execute("""
                INSERT INTO expenses
                (user_id, title, amount, category, expense_date, description)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                user_id, title, amount, category,
                date_value, description
            ))

        return jsonify({"message": "Expense added successfully."}), 201

    except ValueError as error:
        return jsonify({"error": str(error)}), 400


@app.route("/api/expenses/<int:expense_id>", methods=["PUT", "DELETE"])
@login_required
def expense_detail(expense_id):
    user_id = session["user_id"]

    if request.method == "DELETE":
        with get_db() as db:
            cursor = db.execute("""
                DELETE FROM expenses
                WHERE id = ? AND user_id = ?
            """, (expense_id, user_id))

        if cursor.rowcount == 0:
            return jsonify({"error": "Expense not found."}), 404

        return jsonify({"message": "Expense deleted successfully."})

    data = request.get_json(silent=True) or {}

    try:
        title, amount, category, date_value, description = (
            validate_transaction(data, CATEGORIES)
        )

        with get_db() as db:
            cursor = db.execute("""
                UPDATE expenses
                SET title = ?, amount = ?, category = ?,
                    expense_date = ?, description = ?
                WHERE id = ? AND user_id = ?
            """, (
                title, amount, category, date_value,
                description, expense_id, user_id
            ))

        if cursor.rowcount == 0:
            return jsonify({"error": "Expense not found."}), 404

        return jsonify({"message": "Expense updated successfully."})

    except ValueError as error:
        return jsonify({"error": str(error)}), 400


# ---------------- INCOME ----------------

@app.route("/api/income", methods=["GET", "POST"])
@login_required
def income_api():
    user_id = session["user_id"]

    if request.method == "GET":
        with get_db() as db:
            rows = db.execute("""
                SELECT id, title, amount, income_date, description
                FROM income
                WHERE user_id = ?
                ORDER BY income_date DESC, id DESC
            """, (user_id,)).fetchall()

        return jsonify([dict(row) for row in rows])

    data = request.get_json(silent=True) or {}

    try:
        title, amount, _, date_value, description = (
            validate_transaction(data)
        )

        with get_db() as db:
            db.execute("""
                INSERT INTO income
                (user_id, title, amount, income_date, description)
                VALUES (?, ?, ?, ?, ?)
            """, (
                user_id, title, amount, date_value, description
            ))

        return jsonify({"message": "Income added successfully."}), 201

    except ValueError as error:
        return jsonify({"error": str(error)}), 400


@app.route("/api/income/<int:income_id>", methods=["DELETE"])
@login_required
def delete_income(income_id):
    with get_db() as db:
        cursor = db.execute("""
            DELETE FROM income
            WHERE id = ? AND user_id = ?
        """, (income_id, session["user_id"]))

    if cursor.rowcount == 0:
        return jsonify({"error": "Income record not found."}), 404

    return jsonify({"message": "Income deleted successfully."})


# ---------------- ANALYTICS ----------------

@app.route("/api/analytics")
@login_required
def analytics():
    user_id = session["user_id"]

    today = datetime.now().date()
    current_month = today.strftime("%Y-%m")
    previous_month_date = (
        today.replace(day=1) - __import__("datetime").timedelta(days=1)
    )
    previous_month = previous_month_date.strftime("%Y-%m")

    with get_db() as db:
        current_expenses = db.execute("""
            SELECT COALESCE(SUM(amount), 0)
            FROM expenses
            WHERE user_id = ? AND substr(expense_date, 1, 7) = ?
        """, (user_id, current_month)).fetchone()[0]

        previous_expenses = db.execute("""
            SELECT COALESCE(SUM(amount), 0)
            FROM expenses
            WHERE user_id = ? AND substr(expense_date, 1, 7) = ?
        """, (user_id, previous_month)).fetchone()[0]

        current_income = db.execute("""
            SELECT COALESCE(SUM(amount), 0)
            FROM income
            WHERE user_id = ? AND substr(income_date, 1, 7) = ?
        """, (user_id, current_month)).fetchone()[0]

        category = db.execute("""
            SELECT category, SUM(amount) AS total
            FROM expenses
            WHERE user_id = ? AND substr(expense_date, 1, 7) = ?
            GROUP BY category
            ORDER BY total DESC
            LIMIT 1
        """, (user_id, current_month)).fetchone()

        daily = db.execute("""
            SELECT expense_date AS date, SUM(amount) AS total
            FROM expenses
            WHERE user_id = ? AND substr(expense_date, 1, 7) = ?
            GROUP BY expense_date
            ORDER BY expense_date
        """, (user_id, current_month)).fetchall()

        monthly = db.execute("""
            SELECT substr(expense_date, 1, 7) AS month,
                   SUM(amount) AS total
            FROM expenses
            WHERE user_id = ?
            GROUP BY substr(expense_date, 1, 7)
            ORDER BY month DESC
            LIMIT 12
        """, (user_id,)).fetchall()

    savings = current_income - current_expenses
    savings_percentage = (
        (savings / current_income) * 100 if current_income > 0 else 0
    )

    return jsonify({
        "current_month": current_month,
        "previous_month": previous_month,
        "current_expenses": current_expenses,
        "previous_expenses": previous_expenses,
        "current_income": current_income,
        "savings": savings,
        "savings_percentage": round(savings_percentage, 2),
        "highest_category": dict(category) if category else None,
        "daily_trends": [dict(row) for row in daily],
        "monthly_trends": [dict(row) for row in reversed(monthly)]
    })


# ---------------- REPORTS ----------------

def get_report_data(user_id):
    year = request.args.get("year", str(datetime.now().year))
    month = request.args.get("month")

    if not year.isdigit() or not 1900 <= int(year) <= 9999:
        raise ValueError("Invalid report year.")

    if month is not None:
        if not month.isdigit() or not 1 <= int(month) <= 12:
            raise ValueError("Invalid report month.")

    with get_db() as db:
        if month:
            rows = db.execute("""
                SELECT * FROM expenses
                WHERE user_id = ?
                  AND substr(expense_date, 1, 4) = ?
                  AND CAST(substr(expense_date, 6, 2) AS INTEGER) = ?
                ORDER BY expense_date DESC
            """, (user_id, year, int(month))).fetchall()
        else:
            rows = db.execute("""
                SELECT * FROM expenses
                WHERE user_id = ?
                  AND substr(expense_date, 1, 4) = ?
                ORDER BY expense_date DESC
            """, (user_id, year)).fetchall()

        category_rows = db.execute("""
            SELECT category, SUM(amount) AS total
            FROM expenses
            WHERE user_id = ?
              AND substr(expense_date, 1, 4) = ?
              AND (? IS NULL OR substr(expense_date, 6, 2) = ?)
            GROUP BY category
            ORDER BY total DESC
        """, (user_id, year, month, str(month).zfill(2) if month else None)).fetchall()

        monthly_rows = db.execute("""
            SELECT CAST(substr(expense_date, 6, 2) AS INTEGER) AS month,
                   SUM(amount) AS total
            FROM expenses
            WHERE user_id = ?
              AND substr(expense_date, 1, 4) = ?
            GROUP BY substr(expense_date, 6, 2)
            ORDER BY month
        """, (user_id, year)).fetchall()

    total = sum(row["amount"] for row in rows)

    return {
        "year": year,
        "month": month,
        "total_expenses": total,
        "total_transactions": len(rows),
        "categories": [dict(row) for row in category_rows],
        "monthly_totals": [dict(row) for row in monthly_rows],
        "expenses": [dict(row) for row in rows]
    }


@app.route("/api/reports")
@login_required
def reports_api():
    try:
        return jsonify(get_report_data(session["user_id"]))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400


@app.route("/api/reports/pdf")
@login_required
def report_pdf():
    try:
        report = get_report_data(session["user_id"])
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer, pagesize=landscape(A4),
        rightMargin=15 * mm, leftMargin=15 * mm,
        topMargin=15 * mm, bottomMargin=15 * mm
    )

    styles = getSampleStyleSheet()
    elements = [
        Paragraph("SmartSpend - Expense Report", styles["Title"]),
        Spacer(1, 8 * mm),
        Paragraph(
            f"Period: {report['month'] or 'All months'} / {report['year']}",
            styles["Normal"]
        ),
        Paragraph(
            f"Total Expenses: Rs. {report['total_expenses']:,.2f}",
            styles["Heading2"]
        ),
        Spacer(1, 5 * mm)
    ]

    table_data = [["Title", "Category", "Date", "Amount"]]

    for expense in report["expenses"]:
        table_data.append([
            expense["title"],
            expense["category"],
            expense["expense_date"],
            f"Rs. {expense['amount']:,.2f}"
        ])

    table = Table(table_data, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#302d5d")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
        ("PADDING", (0, 0), (-1, -1), 7),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.white, colors.HexColor("#f2f3f8")])
    ]))

    elements.append(table)
    document.build(elements)
    buffer.seek(0)

    return send_file(
        buffer,
        as_attachment=True,
        download_name="smartspend-report.pdf",
        mimetype="application/pdf"
    )


@app.route("/api/reports/excel")
@login_required
def report_excel():
    try:
        report = get_report_data(session["user_id"])
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Expenses"

    sheet.append(["Title", "Category", "Date", "Amount"])

    for cell in sheet[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill(
            start_color="302D5D",
            end_color="302D5D",
            fill_type="solid"
        )
        cell.alignment = Alignment(horizontal="center")

    for expense in report["expenses"]:
        sheet.append([
            expense["title"],
            expense["category"],
            expense["expense_date"],
            expense["amount"]
        ])

    for column in sheet.columns:
        width = max(len(str(cell.value or "")) for cell in column) + 3
        sheet.column_dimensions[
            get_column_letter(column[0].column)
        ].width = min(width, 40)

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)

    return send_file(
        buffer,
        as_attachment=True,
        download_name="smartspend-report.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


# ---------------- START ----------------

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=True)
