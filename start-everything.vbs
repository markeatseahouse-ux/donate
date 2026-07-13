Set WshShell = CreateObject("WScript.Shell")

' 1. Start the Node.js Server silently (0 hides the CMD window, false returns immediately)
WshShell.Run "cmd.exe /c npm start", 0, false

' 2. Wait 1.5 seconds for server to initialize
WScript.Sleep 1500

' 3. Start the Cloudflare Tunnel Launcher (runs the bat file which closes itself once Notepad opens)
WshShell.Run "cmd.exe /c run-cloudflare-tunnel.bat", 1, false
