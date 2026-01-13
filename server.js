const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));

const db = new sqlite3.Database("./users.db", (err)=>{
  if(err) console.error(err);
  else console.log("Connected to SQLite database.");
});

db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT,
  status TEXT DEFAULT 'pending'
)`);

// 註冊
app.post("/register", (req,res)=>{
  const {username,password}=req.body;
  if(!username||!password) return res.status(400).send("缺少帳號或密碼");

  db.run("INSERT INTO users(username,password) VALUES (?,?)",[username,password],function(err){
    if(err) return res.status(400).send("帳號已存在");
    res.send("註冊成功，請等待管理員審核");
  });
});

// 登入
app.post("/login", (req,res)=>{
  const {username,password}=req.body;
  db.get("SELECT * FROM users WHERE username=? AND password=? AND status='approved'",[username,password],(err,row)=>{
    if(err) return res.status(500).send("伺服器錯誤");
    if(row) res.sendFile(path.join(__dirname,"public/123.html"));
    else res.status(401).send("帳號密碼錯誤或尚未審核");
  });
});

// 管理員查看
app.get("/admin/users", (req,res)=>{
  db.all("SELECT id,username,password,status FROM users",[],(err,rows)=>{
    if(err) return res.status(500).json({message:"伺服器錯誤"});
    res.json(rows);
  });
});

// 管理員批准
app.post("/admin/approve", (req,res)=>{
  const {id}=req.body;
  db.run("UPDATE users SET status='approved' WHERE id=?",[id],function(err){
    if(err) return res.status(500).json({message:"伺服器錯誤"});
    res.json({message:"已批准"});
  });
});

app.listen(PORT,()=>console.log(`Server running on port ${PORT}`));
