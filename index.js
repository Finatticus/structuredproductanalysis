const express = require("express");
const bcrypt = require("bcrypt");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const db = new sqlite3.Database("./users.db");

db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT,
  role TEXT DEFAULT 'user',
  status TEXT DEFAULT 'pending'
)`);

// 註冊 API
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if(!username || !password) return res.status(400).json({message:"請輸入帳號密碼"});
  const hash = await bcrypt.hash(password,10);
  db.run("INSERT INTO users(username,password) VALUES(?,?)", [username,hash], function(err){
    if(err) return res.status(400).json({message:"帳號已存在"});
    res.json({message:"註冊成功，等待管理員審核"});
  });
});

// 登入 API
app.post("/login", (req,res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username = ?", [username], async (err,row) => {
    if(!row) return res.status(400).json({message:"帳號不存在"});
    if(row.status !== "approved") return res.status(403).json({message:"帳號尚未審核"});
    const match = await bcrypt.compare(password, row.password);
    if(match){
      res.json({message:"登入成功", token:"dummy_token"}); // 之後可以加 JWT
    } else {
      res.status(400).json({message:"密碼錯誤"});
    }
  });
});

app.listen(3000, () => console.log("Server running on port 3000"));
