# keyline product demo (#38) — install → login → link → push → pull → run.
# Reproducible: `demo/setup.sh && vhs demo/demo.tape && demo/teardown.sh`.
# Every command is real: real npm install, real CLI, real API (local, in-memory).

Output demo/keyline-demo.gif
Output demo/keyline-demo.mp4
Output demo/keyline-demo.webm

Set Shell "bash"
Set FontSize 22
Set Width 1100
Set Height 620
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 55ms

# Hidden setup: the scratch env from demo/setup.sh.
Hide
Type "source demo/.demo-env && clear" Enter
Sleep 1s
Show

# 1. Install
Type "curl -fsSL keyline.sh/install | sh"
Sleep 500ms
Enter
Sleep 7s

# 2. Login — two questions.
Type "keyline login"
Sleep 500ms
Enter
Sleep 1.5s
Type "acme"
Sleep 300ms
Enter
Sleep 800ms
Type "dev@acme.sh"
Sleep 300ms
Enter
Sleep 2s

# 3. Bind the project folder.
Type "cd acme-api && cat .env"
Sleep 500ms
Enter
Sleep 2.5s
Type "keyline link"
Sleep 500ms
Enter
Sleep 2s

# 4. Push — encrypted on this machine before upload.
Type "keyline push"
Sleep 500ms
Enter
Sleep 3s

# 5. Pull — the round trip (this is what a teammate runs).
Type "rm .env && keyline pull"
Sleep 500ms
Enter
Sleep 3s

# 6. Run — secrets injected, nothing written to disk.
Type "keyline run -- node server.js"
Sleep 500ms
Enter
Sleep 4.5s

Type "# your .env never left this machine unencrypted."
Sleep 3.5s
