// ====== 套件 ======
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3").verbose();

const app = express();
app.use(cors());
app.use(express.json());

const SECRET = "FCN_SECRET_KEY"; // JWT 密鑰

// ====== 建立資料庫 ======
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

// ====== 註冊 API ======
app.post("/register", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "請輸入帳號與密碼" });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    db.run(
      `INSERT INTO users (username, password) VALUES (?, ?)`,
      [username, hash],
      function(err) {
        if (err) {
          return res.status(400).json({ message: "帳號已存在" });
        }
        res.json({ message: "註冊成功，等待管理員審核" });
      }
    );
  } catch (err) {
    res.status(500).json({ message: "伺服器錯誤" });
  }
});

// ====== 登入 API ======
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "請輸入帳號與密碼" });
  }

  db.get(
    "SELECT * FROM users WHERE username = ?",
    [username],
    async (err, row) => {
      if (err || !row) return res.status(400).json({ message: "帳號不存在" });

      if (row.status !== "approved") {
        return res.status(403).json({ message: "帳號尚未審核" });
      }

      const match = await bcrypt.compare(password, row.password);
      if (!match) return res.status(400).json({ message: "密碼錯誤" });

      const token = jwt.sign({ id: row.id, username: row.username, role: row.role }, SECRET, { expiresIn: "1h" });
      res.json({ message: "登入成功", token });
    }
  );
});

// ====== 管理員查看待審核帳號 ======
app.get("/admin/pending", (req, res) => {
  db.all("SELECT id, username, role, status FROM users WHERE status='pending'", [], (err, rows) => {
    if (err) return res.status(500).json({ message: "伺服器錯誤" });
    res.json(rows);
  });
});

// ====== 管理員審核帳號 ======
app.post("/admin/approve/:id", (req, res) => {
  const id = req.params.id;
  db.run("UPDATE users SET status='approved' WHERE id=?", [id], function(err) {
    if (err) return res.status(500).json({ message: "伺服器錯誤" });
    res.json({ message: "帳號已批准" });
  });
});


// 取得所有使用者
app.get("/admin/users", (req,res)=>{
  db.all("SELECT * FROM users", [], (err, rows)=>{
    if(err) return res.status(500).json({message:"伺服器錯誤"});
    res.json(rows);
  });
});

// 批准帳號
app.post("/admin/approve", (req,res)=>{
  const { id } = req.body;
  db.run("UPDATE users SET status='approved' WHERE id=?", [id], function(err){
    if(err) return res.status(500).json({message:"伺服器錯誤"});
    res.json({message:"已批准"});
  });
});

// 刪除帳號
app.post("/admin/delete", (req,res)=>{
  const { id } = req.body;
  db.run("DELETE FROM users WHERE id=?", [id], function(err){
    if(err) return res.status(500).json({message:"伺服器錯誤"});
    res.json({message:"已刪除"});
  });
});


// ====== 啟動伺服器 ======
app.listen(3000, () => {
  console.log("Backend running on http://localhost:3000");
});
