# Blitzkrieg – Host & Operator Field Manual

This guide is the complete operational and technical handbook for organizing, deploying, and adjudicating competitive typing tournaments using **Blitzkrieg**.

---

## Table of Contents

1. [Host Roles & Responsibilities](#1-host-roles--responsibilities)
2. [Phase 1: Server & Network Infrastructure Setup](#2-phase-1-server--network-infrastructure-setup)
3. [Phase 2: Client Station Preparation (Lab Setup)](#3-phase-2-client-station-preparation-lab-setup)
4. [Phase 3: Contest Setup & Participant Ingestion](#4-phase-3-contest-setup--participant-ingestion)
5. [Phase 4: Running Round 1 (Qualifiers)](#5-phase-4-running-round-1-qualifiers)
6. [Phase 5: Transitioning to Round 2 (Finals)](#6-phase-5-transitioning-to-round-2-finals)
7. [Phase 6: Adjudication, Tie-Breaks & Results Export](#7-phase-6-adjudication-tie-breaks--results-export)
8. [Anti-Cheat & Incident Handling](#8-anti-cheat--incident-handling)
9. [Crash Recovery & Disaster Management](#9-crash-recovery--disaster-management)
10. [Troubleshooting & Network FAQ](#10-troubleshooting--network-faq)

---

## 1. Host Roles & Responsibilities

In Blitzkrieg, the **Host** serves as both the **System Administrator** and the **Tournament Judge**:
- **Sole Administrative Authority**: You control room lifecycle, passage assignments, round start/stop timers, station transfers, and final result certification.
- **Offline LAN Resilience**: Blitzkrieg runs completely self-contained within your local network switch/router without requiring an external internet connection during the event.
- **Real-Time Proctoring**: The Host dashboard streams live telemetry (WPM, accuracy, progress, focus state) for up to 50+ concurrent laboratory stations.

---

## 2. Phase 1: Server & Network Infrastructure Setup

### Hardware & Network Recommendations
- **Host Machine**: Laptop or desktop with at least 8 GB RAM and multi-core CPU (Intel i5/Ryzen 5 or better).
- **Network**: Dedicated Gigabit LAN switch or high-throughput Wi-Fi 6 router. For 30–50 stations, wired Ethernet is strongly recommended for deterministic sub-10ms latency.
- **Client PCs**: Standard college lab PCs running modern browsers (Google Chrome, Microsoft Edge, Brave, or Mozilla Firefox).

### Step 1: Install Node.js
Ensure the Host machine has **Node.js 22+** installed:
```bash
node -v   # Should output v22.x.x or higher
npm -v    # Should output v10.x.x or higher
```

### Step 2: Clone and Install Blitzkrieg
```bash
git clone https://github.com/ash-ftw/blitzkrieg.git
cd blitzkrieg
npm install
```

### Step 3: Configure Environment Variables
Create your local environment file:
```bash
cp .env.example .env
```
Default ports:
- **Backend API & WebSockets**: `PORT=4000`
- **Frontend Dashboard & Client UI**: Port `5173` (configured via Vite)

### Step 4: Determine the Host LAN IP Address
All lab client PCs must navigate to your host IP address. Find your IPv4 address:

- **Windows (PowerShell)**:
  ```powershell
  Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet' } | Select-Object IPAddress, InterfaceAlias
  # Or simply:
  ipconfig
  ```
  Look for your Ethernet or Wi-Fi IPv4 address (e.g., `192.168.1.50`).

- **Linux / macOS**:
  ```bash
  ip -br addr show   # Linux
  ifconfig           # macOS
  ```

### Step 5: Configure Host Firewall Rules
Ensure inbound traffic to ports `4000` (Socket.IO/REST) and `5173` (Vite UI) is permitted through the Host firewall:

- **Windows (Run in Administrator PowerShell)**:
  ```powershell
  New-NetFirewallRule -DisplayName "Blitzkrieg Tournament Ports" -Direction Inbound -LocalPort 4000,5173 -Protocol TCP -Action Allow
  ```
- **Linux (UFW)**:
  ```bash
  sudo ufw allow 4000/tcp
  sudo ufw allow 5173/tcp
  ```

### Step 6: Start the Blitzkrieg Server
Launch both backend and frontend concurrently:
```bash
npm run dev
```
You will see output indicating:
- `[backend] Fastify listening on http://0.0.0.0:4000`
- `[frontend] Vite dev server running on http://0.0.0.0:5173`

*(Optional Docker deployment: Run `docker compose up -d` if using external persistence containers).*

---

## 3. Phase 2: Client Station Preparation (Lab Setup)

### Setting Up Contestant Computers
1. On each student PC (`PC-01`, `PC-02`, etc.), open Chrome, Edge, or Firefox.
2. Navigate to:
   ```text
   http://<HOST_IP>:5173
   ```
   *(Replace `<HOST_IP>` with the Host IP address identified in Phase 1, e.g., `http://192.168.1.50:5173`)*
3. **Recommended Kiosk Mode**:
   To prevent accidental tab navigation or desktop shortcuts:
   - Press `F11` for full screen.
   - Or launch Chrome via terminal:
     ```bash
     chrome.exe --kiosk http://<HOST_IP>:5173 --incognito
     ```
4. **Pre-Flight System Check**:
   Participants can verify their keyboard, typing latency, and screen responsiveness on the welcome screen before logging in.

---

## 4. Phase 3: Contest Setup & Participant Ingestion

### Step 1: Log in to Host Dashboard
1. On your Host machine, open `http://localhost:5173` (or `http://<HOST_IP>:5173`).
2. Toggle to **Host Login**.
3. Use the authorized host credentials:
   - **Authorized Host Accounts**:
     - `max@host.com` (Max Verstappen)
     - `lec@host.com` (Charles Leclerc)
     - `kimi@host.com` (Kimi Antonelli)
   - **Password**: `host123`
4. Click **Sign In as Host**. Your session is saved and persists even if your browser window refreshes.

### Step 2: Create Contest Room
1. In the Host Dashboard, click **Create Room**.
2. Enter the Tournament / Competition Name (e.g., `National Inter-College Typing Grand Prix`).
3. Set or note the **4-digit Room PIN** (e.g., `4829`). Participants will need this PIN to join.

### Step 3: Ingest Participant Email Whitelist
To prevent unauthorized walk-ins, only pre-registered participant emails can enter the contest:
1. Click **Ingest Participants** on the Host navigation bar.
2. Choose your input format:
   - **Bulk Text / Paste**: Paste a list of emails separated by commas, newlines, or spaces:
     ```text
     alice@college.edu
     bob@college.edu
     charlie@college.edu
     ```
   - **CSV Upload**: Upload a `.csv` file containing participant emails.
3. Click **Add Participants**. The server registers them into the active competition whitelist.

### Step 4: Participant Station Assignment
1. Direct participants to enter their **registered email** and the **Room PIN** on their lab computers.
2. Upon login:
   - The server dynamically binds their session to that physical workstation (`PC-01`, `PC-02`, `PC-03`, ...).
   - The station immediately turns **BLUE / ASSIGNED** on your Host Dashboard Station Grid.
3. Each participant clicks **"I am Ready"** on their screen once seated and comfortable.
4. The station turns **GREEN / READY** on your Host Monitor.

---

## 5. Phase 4: Running Round 1 (Qualifiers)

### Step 1: Pre-Round Lock
When all participants are seated and marked **READY**:
1. Click **Lock Room**. This prevents any unexpected new logins during the race.
2. Verify that all stations in the live grid are in the **READY** status.

### Step 2: Start Round 1
1. Click **Start Round 1**.
2. A synchronized **3-second visual and audio countdown** activates across all participant screens simultaneously.
3. The server starts the round timer (e.g., 180 seconds). All contestants receive the identical Round 1 passage.

### Step 3: Real-Time Live Monitoring
During the round, your dashboard displays real-time telemetry for every station:
- **Net WPM**: Live calculation based on correctly typed characters.
- **Accuracy**: Real-time error penalty calculation.
- **Progress Bar**: Live completion percentage across the passage.
- **Station Heartbeat**: Detects any machine that drops connection.

---

## 6. Phase 5: Transitioning to Round 2 (Finals)

### Step 1: Conclude Round 1
1. When the countdown timer reaches `00:00`, the server automatically halts all keystroke inputs and collects final submissions.
2. All stations transition to **SUBMITTED** status.

### Step 2: Determine Qualifiers
1. Click **Calculate Qualifiers** in the Host navigation panel.
2. Select the qualifier threshold (e.g., Top 10 or Top 16).
3. The system calculates composite rankings using the authoritative formula:
   $$\text{Score} = \text{Net WPM} \times \left(\frac{\text{Accuracy}}{100}\right)^2$$
4. A history snapshot is automatically generated (e.g., `qualifiers-history-<timestamp>.json`).

### Step 3: Launch Round 2 Room
1. In the qualifiers modal, click **Create Round 2 Room from Qualifiers**.
2. The server:
   - Resets station assignments for the new round.
   - Whitelists only the qualified finalists.
   - Loads the advanced Round 2 technical passage (higher vocabulary complexity, code symbols, and technical syntax).
3. Finalists log in to their assigned stations using the new Round 2 PIN.
4. Host locks room and triggers the Championship Round countdown!

---

## 7. Phase 6: Adjudication, Tie-Breaks & Results Export

### Automatic Tie-Breaking Hierarchy
In the event two contestants have identical scores, the system resolves ties strictly in the following order:
1. **Net WPM**: Higher speed takes precedence.
2. **Raw Accuracy**: Higher precision takes precedence.
3. **Uncorrected Errors**: Lower error count takes precedence.
4. **Completion Timestamp**: Earlier submission takes precedence.

### Exporting Certified Results
1. Click **Finalize Results** on the Host Dashboard.
2. Click **Export CSV** to download the comprehensive tournament record.
3. The export file includes:
   - Participant Name & Registered Email
   - Station Code (`PC-XX`)
   - Final WPM, Raw WPM, and Accuracy %
   - Total Keystrokes, Correct Characters, Incorrect Characters
   - Completion Time & Submission Timestamp
   - Proctoring Audit Flags & Violation Count

---

## 8. Anti-Cheat & Incident Handling

Blitzkrieg includes client-side and server-validated anti-cheat safeguards:

### Automated Safeguards
1. **Clipboard Lockdown**: Copying, cutting, or pasting into the typing area is strictly intercepted and blocked.
2. **Focus / Tab-Switch Detection**: If a participant switches tabs, minimizes the browser, or opens developer tools, a `WINDOW_BLUR` incident is immediately fired to the server.
3. **Keystroke Cadence Analysis**: Unrealistic bursts or automated script typing (e.g., impossible sustained 350+ WPM with 0ms key variance) trigger algorithmic flags.

### Host Adjudication Controls
- **Amber Warning Badge**: Station tile flags any participant with active infractions.
- **View Incidents**: Click any station tile to inspect their violation timestamp log.
- **Disqualify Station**: If a participant commits an intentional rule breach, click **Disqualify**. Their screen is immediately locked with a disqualification notice, and their score is invalidated.

### Station Hardware Failure & Hot-Swapping
If a student's monitor, keyboard, or PC crashes mid-round:
1. Direct the student to an unassigned spare computer (e.g., `PC-SPARE` or `PC-50`).
2. On the Host Dashboard, open the student's station drawer.
3. Select **Transfer Participant** and choose the destination station.
4. If approved by the Host, the student can resume without losing their registration integrity.

---

## 9. Crash Recovery & Disaster Management

Blitzkrieg is architected for zero data loss in the event of hardware or power failure:

- **Periodic State Persistence**: The contest engine automatically serializes the entire state tree (contest status, station telemetry, participant records, incidents, audit logs) to disk every **5 seconds** (`blitzkrieg-snapshot.json`).
- **Server Reboot Recovery**: If the Host machine accidentally restarts or shuts down:
  1. Boot the Host machine and run `npm run dev`.
  2. The persistence layer detects the saved snapshot on startup and automatically restores the contest to its exact pre-crash state!
  3. Lab stations reconnect automatically via Socket.IO without requiring a browser refresh.
- **Host Session Survival**: Host authentication tokens are stored in `host-sessions.json`. You will remain logged in even across server restarts and contest resets.

---

## 10. Troubleshooting & Network FAQ

### Q1: Student PCs cannot access `http://<HOST_IP>:5173`
- **Check Firewall**: Ensure the Host machine allows inbound traffic on ports `4000` and `5173`. Run the PowerShell firewall command in Phase 1.
- **Check Network Isolation**: In some university labs, client Wi-Fi networks have "AP Isolation" enabled, which blocks device-to-device communication. Use a physical ethernet switch or request lab administrators disable client isolation.
- **Check IP Address**: Verify the Host IP has not changed due to DHCP lease renewal. Set a static IP for the Host machine during tournament day.

### Q2: Station shows "Connecting..." or Socket disconnects
- Fastify and Socket.IO listen on `0.0.0.0:4000`. Ensure port `4000` is reachable from the student machine:
  ```bash
  curl http://<HOST_IP>:4000/health
  ```
  Should return status `ok`.

### Q3: How do I completely wipe state to run a brand new tournament?
- In the Host Dashboard, click **Reset Contest State** (or send `POST /contest/reset` with your Host Bearer token). This clears all participant records, stations, and attempts while keeping your Host credentials active.

---

*Blitzkrieg is maintained by [ash-ftw](https://github.com/ash-ftw) and open-source contributors. For questions and feature requests, visit the [GitHub repository](https://github.com/ash-ftw/blitzkrieg).*
