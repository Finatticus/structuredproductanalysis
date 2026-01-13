const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // 前端頁面放 public

// 建立 SQLite 資料庫
const db = new sqlite3.Database("./users.db");
db.run(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT,
  role TEXT DEFAULT 'user',
  status TEXT DEFAULT 'pending'
)
`);

// ------------------ 註冊 API ------------------
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: "請輸入帳號與密碼" });

  try {
    const hash = await bcrypt.hash(password, 10);
    db.run("INSERT INTO users(username,password) VALUES (?,?)", [username, hash], function(err) {
      if (err) return res.status(400).json({ message: "帳號已存在" });
      res.json({ message: "註冊成功，等待管理員審核" });
    });
  } catch (e) {
    res.status(500).json({ message: "伺服器錯誤" });
  }
});

// ------------------ 登入 API ------------------
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username=?", [username], async (err, row) => {
    if (err) return res.status(500).json({ message: "伺服器錯誤" });
    if (!row) return res.status(400).json({ message: "帳號不存在" });
    if (row.status !== "approved") return res.status(400).json({ message: "帳號尚未審核" });
    const match = await bcrypt.compare(password, row.password);
    if (match) {
      res.json({ message: "登入成功", role: row.role });
    } else {
      res.status(400).json({ message: "密碼錯誤" });
    }
  });
});

// ------------------ Admin API ------------------
app.get("/admin/users", (req, res) => {
  db.all("SELECT * FROM users", [], (err, rows) => {
    if (err) return res.status(500).json({ message: "伺服器錯誤" });
    res.json(rows);
  });
});

app.post("/admin/approve", (req, res) => {
  const { id } = req.body;
  db.run("UPDATE users SET status='approved' WHERE id=?", [id], function(err) {
    if (err) return res.status(500).json({ message: "伺服器錯誤" });
    res.json({ message: "已批准" });
  });
});

app.post("/admin/delete", (req, res) => {
  const { id } = req.body;
  db.run("DELETE FROM users WHERE id=?", [id], function(err) {
    if (err) return res.status(500).json({ message: "伺服器錯誤" }
