async function sha256(text) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(buf)]
    .map(b => b.toString(16).padStart(2,"0"))
    .join("");
}

async function login() {
  const u = document.getElementById("username").value.trim();
  const p = document.getElementById("password").value;
  const error = document.getElementById("errorMsg");

  const h = await sha256(p);

  const ok = USERS.some(x =>
    x.username === u && x.hash === h
  );

  if (ok) {
    location.href = "fcn.html";
  } else {
    error.style.display = "block";
  }
}

document.addEventListener("keydown", e => {
  if (e.key === "Enter") login();
});
