const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
app.use(bodyParser.json());
app.use(express.static("public"));

// SQLite
const db = new sqlite3.Database("users.db", err=>{
  if(err) console.error(err);
  else console.log("Connected to SQLite DB");
});

// 建立 users table
db.run(`CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT,
  status TEXT DEFAULT 'pending'
)`);

// Register
app.post("/register", (req,res)=>{
  const {username,password} = req.body;
  if(!username || !password) return res.status(400).send("帳號和密碼不能空白");
  db.run("INSERT INTO users(username,password,status) VALUES(?,?,?)",[username,password,'pending'], function(err){
    if(err){
      if(err.message.includes("UNIQUE")) return res.status(400).send("帳號已存在");
      return res.status(500).send("伺服器錯誤");
    }
    res.send("註冊成功！請等待管理員審核");
  });
});

// Login
app.post("/login",(req,res)=>{
  const {username,password} = req.body;
  db.get("SELECT * FROM users WHERE username=? AND password=? AND status='approved'",
    [username,password],
    (err,row)=>{
      if(err) return res.status(500).send("伺服器錯誤");
      if(row) res.sendStatus(200);
      else res.status(401).send("帳號或密碼錯誤，或尚未審核");
    });
});

// Admin - get users
app.get("/admin/users",(req,res)=>{
  db.all("SELECT * FROM users",[],(err,rows)=>{
    if(err) return res.status(500).json([]);
    res.json(rows);
  });
});

// Admin - approve user
app.post("/admin/approve",(req,res)=>{
  const {id} = req.body;
  db.run("UPDATE users SET status='approved' WHERE id=?",[id], function(err){
    if(err) return res.status(500).send("操作失敗");
    res.send("已批准");
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log("Server running on port",PORT));
