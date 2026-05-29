const { spawn } = require("child_process");
const child = spawn("npx", ["--version"], { shell: true, stdio: "inherit" });
child.on("error", (e) => console.error("ERROR:", e.message));
child.on("exit", (code) => console.log("exit code:", code));