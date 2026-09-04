# Blitzkrieg – Fast Typing Event Platform
## Final Product Requirements Document (PRD)
### Version 1.0 – College LAN Edition

---

## 1. Product Overview

**Product Name:** Blitzkrieg  
**Product Type:** Real-time competitive typing web application  
**Deployment:** College computer laboratory  
**Expected Concurrent Participants:** Up to 50  
**Internet Requirement:** Not required during competition  
**Architecture:** Local Server + LAN + Browser Clients

Blitzkrieg is a web-based typing competition system designed for a controlled college laboratory environment.

The system provides:

- Host-controlled contests
- Registered participants only
- Computer-to-participant assignment
- Two-round competitions
- Real-time monitoring
- Automatic scoring
- Anti-cheat enforcement
- Low-latency typing
- Offline operation over the local LAN

---

# 2. Goals

### Primary Goals

1. Provide a reliable typing competition platform for approximately 50 lab computers.
2. Ensure the contest works without internet access.
3. Minimize typing latency by keeping keyboard processing local to the browser.
4. Make the Host the sole administrative and judging authority.
5. Prevent or detect restarting, tab switching, copy/paste, unauthorized sessions, and other cheating attempts.
6. Ensure all contestants in a round receive the same passage.
7. Make the server authoritative for timing, scoring, qualification, and final results.
8. Provide real-time visibility of all lab computers.
9. Preserve an auditable record of violations, technical incidents, and Host actions.

---

# 3. Non-Goals

The initial version will not require:

- Cloud-only hosting
- Internet-dependent competition
- Multiple judge roles
- Microservices
- Kubernetes
- AI-generated passages during a live contest
- Server processing for every keystroke
- Public participant registration

---

# 4. User Roles

The system has only two roles.

## 4.1 Host

The Host acts as:

- Organizer
- Judge
- Technical administrator

### Host Permissions

The Host can:

- Create contests
- Configure rounds
- Manage registered participants
- Assign computers
- Manage passages
- Start and end rounds
- Monitor all stations
- View live results
- View violations
- Disqualify participants
- Handle technical failures
- Transfer participants between computers
- Approve technical restarts
- View Round 1 rankings
- Determine/confirm Round 2 qualifiers
- View Round 2 rankings
- Resolve tie-breaks
- Finalize results
- Export results
- View the audit log

The Host is the final authority for competition decisions.

---

## 4.2 Participant

Participants can:

- Log in
- Verify their assigned computer
- Complete the system check
- Enter the waiting room
- Participate in active rounds
- Submit automatically at the end of a round
- View permitted results

Participants cannot:

- Create contests
- Modify contest configuration
- Start or stop rounds
- Select passages
- Change computer assignments
- Restart attempts
- Modify scores
- Access Host functions
- Access another participant's session

---

# 5. Competition Structure

## Round 1

| Property | Value |
|---|---|
| Difficulty | Medium |
| Duration | 1 minute |
| Passage | Same for all contestants |
| Qualification | Top N participants |

## Round 2

| Property | Value |
|---|---|
| Difficulty | Hard |
| Duration | 3 minutes |
| Passage | Same for all qualifiers |

The exact number of Round 2 qualifiers is configurable by the Host before the contest is locked.

---

# 6. Scoring

The official scoring formula is:

```text
Final Score = WPM × Accuracy (%)
```

The server calculates the official score.

### Tie-break order

1. Higher Accuracy
2. Fewer Errors
3. Additional Typing Test

The additional typing test is controlled by the Host and server.

### Scoring definitions that must be finalized during implementation

The implementation must explicitly define:

- WPM calculation
- Word boundaries
- Character counting
- Error calculation
- Accuracy calculation
- Treatment of spaces
- Treatment of punctuation
- Treatment of incomplete words

These definitions must remain consistent across all participants.

---

# 7. Network Architecture

The competition is LAN-first.

```text
                    COLLEGE LAB LAN
                           |
                 +---------v---------+
                 |   Local Server    |
                 |    Blitzkrieg     |
                 +---------+---------+
                           |
          +----------------+----------------+
          |                |                |
        PC-01            PC-02            PC-50
```

Internet access is **not required for the actual competition**.

Internet may optionally be used for:

- Software updates
- Cloud backup
- Certificate upload
- Administrative maintenance

None of these should be on the critical competition path.

### Recommended network

- Wired Gigabit Ethernet
- Managed or reliable network switch
- Dedicated server connection
- UPS for the server and network equipment where possible

---

# 8. Technology Stack

## Frontend

| Technology | Purpose |
|---|---|
| React | User interface |
| TypeScript | Type safety |
| Vite | Build tooling |
| Tailwind CSS | Styling |
| Socket.IO Client | Real-time communication |

## Backend

| Technology | Purpose |
|---|---|
| Node.js | Runtime |
| TypeScript | Backend language |
| Fastify | HTTP API |
| Socket.IO | Real-time communication |

## Data

| Technology | Purpose |
|---|---|
| PostgreSQL | Persistent authoritative data |
| Redis | Temporary real-time state and event fan-out |

## Deployment

| Technology | Purpose |
|---|---|
| Docker | Reproducible deployment |
| Nginx or Caddy | Reverse proxy / static delivery |
| Linux | Recommended server OS |

---

# 9. Low-Latency Design

The most important performance rule is:

> Do not send every keystroke to the server.

The typing path is:

```text
Keyboard
   |
   v
Browser Typing Engine
   |
   v
Local UI
```

The server is used for:

- Round state
- Authoritative timer
- Contest synchronization
- Session validation
- Anti-cheat events
- Heartbeats
- Final submission
- Scoring
- Results

This prevents network latency from affecting the typing experience.

---

# 10. Real-Time Communication

Socket.IO is used for:

- Contest start
- Round start
- Round end
- Station status
- Participant status
- Violations
- Technical interruptions
- Result updates
- Host commands

Polling should not be used for normal real-time contest state.

### Example

```text
HOST
  |
  | START_ROUND
  v
SERVER
  |
  +----> PC-01
  +----> PC-02
  +----> PC-03
  ...
  +----> PC-50
```

---

# 11. Redis

Redis is used for volatile/live state such as:

- Active sessions
- Active contest state
- Station heartbeat
- Temporary timer state
- WebSocket event fan-out

Redis must not be the sole permanent record of important competition events.

Permanent competition state belongs in PostgreSQL.

---

# 12. PostgreSQL

PostgreSQL stores:

- Users
- Participants
- Stations
- Contests
- Contest assignments
- Passages
- Attempts
- Scores
- Violations
- Technical incidents
- Audit logs
- Final results

Finalized results must remain persistent and recoverable.

---

# 13. Computer Station System

Approximately 50 lab computers are registered:

```text
PC-01
PC-02
PC-03
...
PC-50
```

Each station has:

```text
stationId
hostname
status
assignedParticipant
activeSession
lastHeartbeat
```

---

# 14. Station States

```text
OFFLINE
AVAILABLE
ASSIGNED
READY
TYPING
SUBMITTED
DISQUALIFIED
TECHNICAL_ISSUE
```

Example:

```text
PC-01 -> READY
PC-02 -> TYPING
PC-03 -> DISQUALIFIED
PC-04 -> SUBMITTED
PC-05 -> AVAILABLE
PC-06 -> OFFLINE
```

---

# 15. Automatic Station Identification

Participants should not manually select their computer.

Each lab system should have a registered station identity.

Example:

```text
PC-17
   |
   v
station_id = LAB-PC-17
   |
   v
Participant Login
   |
   v
BZK024
```

The server verifies:

```text
Participant <-> Station <-> Active Session
```

A participant cannot simply claim another station by changing a client-side value.

---

# 16. Computer Assignment

Before the contest:

```text
PC-01 -> BZK001
PC-02 -> BZK002
PC-03 -> BZK003
...
PC-50 -> BZK050
```

Host can view:

| Computer | Participant | Status |
|---|---|---|
| PC-01 | BZK001 | Ready |
| PC-02 | BZK002 | Ready |
| PC-03 | BZK003 | Disqualified |
| PC-04 | BZK004 | Typing |
| PC-05 | — | Unassigned |

---

# 17. Authentication

There is no public registration.

Participants are pre-registered.

Authentication flow:

```text
Username + Password
        |
        v
Authentication
        |
        v
Registration Check
        |
        v
Station Check
        |
        v
Contest Eligibility
        |
        v
Active Session
```

### One active session

A participant can have only one active competition session.

Example:

```text
BZK024 -> PC-17
```

Attempting to simultaneously use another station is rejected and logged.

---

# 18. Contest Lifecycle

```text
DRAFT
  |
  v
READY
  |
  v
ROUND_1
  |
  v
ROUND_1_COMPLETE
  |
  v
QUALIFICATION
  |
  v
ROUND_2
  |
  v
ROUND_2_COMPLETE
  |
  v
FINALIZED
```

Once a live round begins, critical contest configuration is locked.

---

# 19. Contest Creation

Host configures:

```text
Contest Name
Round 1 Duration
Round 1 Difficulty
Round 2 Duration
Round 2 Difficulty
Number of Round 2 Qualifiers
Participant List
```

Example:

```text
Contest:
Blitzkrieg – Fast Typing

Round 1:
Medium / 60 seconds

Round 2:
Hard / 180 seconds

Qualifiers:
10
```

---

# 20. Contest Lock

When Round 1 begins, the following become locked:

- Participant list
- Round duration
- Qualification count
- Passage selection
- Competition rules
- Scoring configuration

This prevents accidental or intentional rule changes during competition.

---

# 21. Passage Management

Passages are stored locally in the database.

## Round 1

Example bank:

```text
P-R1-001
P-R1-002
...
P-R1-030
```

## Round 2

```text
P-R2-001
P-R2-002
...
P-R2-030
```

The exact number of passages is configurable.

---

# 22. Passage Generation

AI may be used **before the event** to generate candidate passages.

Recommended pipeline:

```text
AI Generation
      |
      v
Candidate Passages
      |
      v
Automated Validation
      |
      v
Human Review
      |
      v
Difficulty Analysis
      |
      v
Pilot Typing Tests
      |
      v
Approved Passage Bank
      |
      v
Local Database
```

The live competition must not depend on an external AI API.

---

# 23. Passage Difficulty

## Medium

Round 1 passages should generally use:

- Common vocabulary
- Moderate sentence length
- Normal punctuation
- Moderate word length
- Some capitalization
- Limited numerical content

## Hard

Round 2 passages can use:

- Longer sentences
- More complex punctuation
- Less common vocabulary
- Parentheses
- Semicolons
- Colons
- Hyphenated words
- Numbers
- More capitalization changes

Difficulty should test typing ability rather than obscure factual knowledge.

---

# 24. Passage Fairness

All participants in a round receive the same passage.

Before the event, candidate passages should be tested by multiple typists.

Record:

- Average WPM
- Average accuracy
- Error rate
- Completion behavior

Reject passages that are clearly anomalous.

---

# 25. Passage Security

Future passages should not be unnecessarily exposed to participant browsers.

At waiting stage:

```text
Waiting Room
```

At round start:

```text
Host -> START
       |
       v
Server selects passage
       |
       v
Passage released
       |
       v
Round begins
```

Round 2 passages should not be sent to Round 1 participants.

---

# 26. Typing Engine

Typing is processed locally in the participant browser.

```text
Keyboard
   |
   v
React Typing Engine
   |
   v
Local State
   |
   v
Rendered Text
```

The server does not process every keypress.

---

# 27. Timer

The server owns the official timer.

Example:

```text
startTime = 12:00:00.000
endTime   = 12:01:00.000
```

The browser displays the countdown.

If the browser refreshes, the server returns the existing attempt and remaining time.

Refreshing must never create a new attempt.

---

# 28. Round 1 Process

```text
Host Starts Round
       |
       v
Server Selects Passage
       |
       v
Server Records Start/End Time
       |
       v
Passage Released
       |
       v
Typing
       |
       v
60 Seconds
       |
       v
Typing Disabled
       |
       v
Submission
       |
       v
Server Scoring
```

---

# 29. Round 2 Process

```text
Round 1 Results
       |
       v
Server Ranking
       |
       v
Top N Qualifiers
       |
       v
Round 2 Ready
       |
       v
Host Starts Round
       |
       v
Hard Passage Released
       |
       v
180 Seconds
       |
       v
Submission
       |
       v
Final Scoring
```

---

# 30. Submission

At the official end time:

```text
Timer Expires
     |
     v
Typing Disabled
     |
     v
Final Text Captured
     |
     v
Server Validation
     |
     v
Score Calculation
     |
     v
Attempt Finalized
```

A participant cannot change a finalized attempt.

---

# 31. Backspace

Backspace is allowed.

The final submitted text is what is evaluated.

Example:

```text
Wrong
  |
Backspace
  |
Correct
  |
Final text
```

The implementation should apply the event's defined final-text error policy consistently.

---

# 32. Anti-Cheat System

The system should monitor:

```text
TAB_SWITCH
WINDOW_BLUR
COPY
PASTE
CUT
CONTEXT_MENU
PAGE_REFRESH
NAVIGATION
FULLSCREEN_EXIT
MULTIPLE_SESSION
RESTART_ATTEMPT
UNAUTHORIZED_STATION
```

---

# 33. Disqualification Policy

High-confidence prohibited actions can result in automatic disqualification.

Examples:

```text
PASTE
RESTART_ATTEMPT
UNAUTHORIZED_SESSION
PROHIBITED_NAVIGATION
```

Events such as tab switching/window blur should be configurable so the Host can decide whether the event's final rules treat them as immediate DQ or as a recorded violation.

Every violation must be logged.

---

# 34. Technical Failures

Technical failures must be distinguished from cheating.

Examples:

```text
PC Crash
Browser Crash
Power Failure
LAN Failure
Server Failure
```

Participant state becomes:

```text
TECHNICAL_ISSUE
```

The Host decides:

- Resume
- Restart
- Transfer
- Disqualify

---

# 35. Session Transfer

Example:

```text
PC-17
BZK024
TECHNICAL_ISSUE
```

Host can:

```text
Transfer to PC-31
```

The system records:

```text
PC-17 -> failed
PC-31 -> BZK024
```

All transfers are added to the audit log.

---

# 36. Host Dashboard

The Host dashboard is the single command center.

Example:

```text
BLITZKRIEG — HOST CONTROL PANEL

Round 1
Medium Text
01:00

Connected: 48
Ready: 43
Typing: 3
Submitted: 1
DQ: 1
Offline: 2
```

Station table:

| PC | Participant | Status | WPM | Accuracy | Score |
|---|---|---|---:|---:|---:|
| PC-01 | BZK001 | Ready | — | — | — |
| PC-02 | BZK002 | Typing | — | — | — |
| PC-03 | BZK003 | DQ | — | — | — |
| PC-04 | BZK004 | Submitted | 103 | 97.2% | — |
| PC-05 | — | Available | — | — | — |

The dashboard updates in real time.

---

# 37. Lab Overview

A visual grid provides immediate status of all stations.

```text
PC-01  🟢
PC-02  🔵
PC-03  🔴
PC-04  🟡
PC-05  ⚪
...
PC-50  🟢
```

Legend:

- 🟢 Ready
- 🔵 Typing
- 🟡 Submitted
- 🔴 Disqualified
- ⚪ Available
- 🟠 Technical issue
- ⚫ Offline

---

# 38. Host Results

The Host can view results at all stages.

## Round 1

```text
Rank | Participant | WPM | Accuracy | Errors | Score | Status
----------------------------------------------------------------
1    | BZK024      | 118 | 99.1%    | 4      | ...   | Qualified
2    | BZK011      | 114 | 99.5%    | 3      | ...   | Qualified
3    | BZK031      | 110 | 98.8%    | 6      | ...   | Qualified
```

## Final Results

```text
Rank | Participant | WPM | Accuracy | Errors | Score
-------------------------------------------------------
1    | BZK024      | ... | ...      | ...    | ...
2    | BZK011      | ... | ...      | ...    | ...
3    | BZK031      | ... | ...      | ...    | ...
```

---

# 39. Violation Monitoring

The Host receives violations in real time.

Example:

```text
VIOLATION

Participant: BZK024
Computer: PC-17
Round: 1

Type: PASTE
Time: 00:32

Action: DISQUALIFIED
```

Technical issue:

```text
TECHNICAL INTERRUPTION

Participant: BZK031
Computer: PC-22

Network connection lost.

[TRANSFER]
[RESTART]
[DISQUALIFY]
```

---

# 40. Audit Log

The system records important actions.

Examples:

```text
HOST_CREATED_CONTEST
HOST_STARTED_ROUND
HOST_ENDED_ROUND
HOST_DISQUALIFIED_PARTICIPANT
HOST_APPROVED_RESTART
HOST_TRANSFERRED_SESSION
HOST_FINALIZED_RESULTS
PARTICIPANT_TAB_SWITCH
PARTICIPANT_PASTE
PARTICIPANT_REFRESH
TECHNICAL_INTERRUPTION
```

Each record should include:

```text
timestamp
user/participant
station
contest
round
action
metadata
```

---

# 41. Security Model

The server must never trust:

```text
Client Score
Client Timer
Client Ranking
Client Qualification
Client Participant ID
Client Contest ID
Client Round
```

The server validates and calculates authoritative competition state.

---

# 42. Browser/Kiosk Environment

Because the competition takes place on controlled college computers, the lab should standardize:

- Browser version
- Keyboard layout
- Browser zoom
- Extensions
- Notifications
- Display configuration

Where possible, use browser/OS kiosk mode.

This provides stronger protection than JavaScript anti-cheat alone.

---

# 43. Heartbeat

Every active station sends a lightweight heartbeat.

Example:

```text
PC-17
Last heartbeat: 0.8 sec ago
Connection: Healthy
```

If heartbeats stop:

```text
PC-17 OFFLINE
```

The Host is immediately notified.

---

# 44. API

Example REST endpoints:

```text
POST /auth/login

GET /contest/current

POST /contest

POST /contest/:id/start

POST /contest/:id/round/start

GET /contest/:id/participants

GET /contest/:id/stations

POST /participant/:id/disqualify

POST /participant/:id/transfer

GET /contest/:id/results

POST /contest/:id/finalize
```

WebSocket events:

```text
contest:state
contest:round-start
contest:round-end
station:status
participant:status
participant:violation
participant:technical
leaderboard:update
```

---

# 45. Database Schema

## User

```text
id
username
passwordHash
role
createdAt
```

## Participant

```text
id
userId
studentId
name
registered
verified
eligible
```

## Station

```text
id
stationCode
hostname
status
lastHeartbeat
```

## Contest

```text
id
name
status
createdBy
createdAt
```

## ContestParticipant

```text
contestId
participantId
stationId
status
joinedAt
```

## Passage

```text
id
round
difficulty
content
wordCount
characterCount
active
version
```

## Attempt

```text
id
contestId
participantId
round
passageId
startTime
endTime
submittedText
wpm
accuracy
errors
score
status
```

## Violation

```text
id
participantId
contestId
round
stationId
type
timestamp
metadata
action
```

## AuditLog

```text
id
userId
action
timestamp
metadata
```

---

# 46. Performance Requirements

The system should support:

- 50 concurrent participants
- 1 Host
- Real-time station monitoring
- Simultaneous round start
- Simultaneous submission
- Real-time violation events

### Design target

```text
Typing input:
Local / effectively immediate

Typical LAN communication:
Very low latency

UI updates:
Real time

Server:
50 participants with significant headroom
```

The system should not depend on a particular latency value for scoring correctness.

---

# 47. Reliability Requirements

The system must:

- Prevent duplicate attempts
- Preserve official timer state
- Preserve finalized scores
- Prevent unauthorized participants
- Prevent unauthorized stations
- Prevent round changes after lock
- Preserve violation records
- Preserve Host actions
- Recover from ordinary browser refreshes
- Provide backups of competition data

---

# 48. Server Hardware

Recommended:

| Component | Recommendation |
|---|---|
| CPU | 4–8 modern cores |
| RAM | 8–16 GB |
| Storage | SSD |
| Network | Gigabit Ethernet |
| Power | UPS |
| OS | Linux |

For 50 participants, reliability and network stability are more important than extreme server hardware.

---

# 49. Pre-Event System Check

Every computer opens:

```text
BLITZKRIEG SYSTEM CHECK

✓ Server connection
✓ WebSocket connection
✓ Keyboard detected
✓ Browser supported
✓ Fullscreen available
✓ Station identified
✓ Participant authenticated
✓ Contest loaded
✓ Clock synchronized

SYSTEM READY
```

The Host sees:

```text
48 / 50 READY
```

The contest should not start until the Host confirms the lab is ready.

---

# 50. Backup Strategy

Before the event:

- Backup database
- Backup passage bank
- Backup configuration
- Verify server
- Verify recovery procedure

During the event:

- Maintain persistent database storage
- Periodically snapshot/export critical data where practical

After the event:

- Export final results
- Backup database
- Preserve audit logs

---

# 51. Building Phases

The application should be built incrementally.

---

## Phase 0 – Requirements and Rule Freeze

### Objective

Finalize the exact competition rules before coding.

### Tasks

- Confirm Round 1 duration
- Confirm Round 2 duration
- Confirm qualifier count
- Confirm scoring formula
- Define WPM calculation
- Define accuracy calculation
- Define error calculation
- Define tab-switch policy
- Define paste/copy policy
- Define refresh/restart policy
- Define technical failure policy
- Define participant result visibility
- Define tie-break procedure

### Deliverable

**Frozen Competition Specification**

No major rule changes should occur after this phase without versioning.

---

# Phase 1 – Project Foundation

### Objective

Create the development foundation.

### Tasks

- Create Git repository
- Configure branch strategy
- Initialize React/Vite frontend
- Initialize Node.js/TypeScript backend
- Configure Fastify
- Configure PostgreSQL
- Configure Redis
- Configure Docker
- Configure environment variables
- Create development/staging configuration
- Establish code quality rules

### Deliverable

Running full-stack skeleton:

```text
Frontend
Backend
PostgreSQL
Redis
Docker
```

---

# Phase 2 – Authentication and User Management

### Objective

Implement the two-role access system.

### Tasks

- Host login
- Participant login
- Password hashing
- Session management
- Role authorization
- Participant registration/import
- One active participant session
- Logout
- Session expiry

### Deliverable

Secure:

```text
HOST
PARTICIPANT
```

authentication.

---

# Phase 3 – Station Management

### Objective

Support the 50 physical lab computers.

### Tasks

- Register stations
- Assign station IDs
- Detect station identity
- Station heartbeat
- Station status
- Participant-to-PC assignment
- Unauthorized station detection
- Host station dashboard

### Deliverable

Host can see:

```text
PC-01 -> BZK001 -> READY
PC-02 -> BZK002 -> READY
...
PC-50 -> BZK050 -> READY
```

---

# Phase 4 – Contest Management

### Objective

Implement the Host-controlled competition lifecycle.

### Tasks

- Create contest
- Configure rounds
- Configure durations
- Configure qualifier count
- Import participants
- Assign stations
- Lock contest
- Contest states
- Host controls

### Deliverable

Complete contest setup and lifecycle.

---

# Phase 5 – Passage Management

### Objective

Build the controlled passage bank.

### Tasks

- Passage CRUD
- Round classification
- Difficulty classification
- Word/character statistics
- Passage validation
- Passage preview
- Passage activation/deactivation
- Passage versioning
- Random server-side selection

### Deliverable

Local passage bank for Round 1 and Round 2.

---

# Phase 6 – Typing Engine

### Objective

Build the core typing experience.

### Tasks

- Render passage
- Keyboard input
- Cursor
- Character comparison
- Backspace
- Local state
- Error tracking
- Word counting
- Accuracy calculation
- WPM calculation
- Timer display
- Automatic submission

### Deliverable

A complete single-player typing test.

---

# Phase 7 – Server-Authoritative Contest Engine

### Objective

Turn the typing test into a synchronized competition.

### Tasks

- Server start time
- Server end time
- Round synchronization
- Passage release
- Attempt creation
- Attempt locking
- Automatic submission
- Server scoring
- Qualification calculation
- Round transitions

### Deliverable

Fully synchronized Round 1 and Round 2.

---

# Phase 8 – Real-Time Infrastructure

### Objective

Provide low-latency live communication.

### Tasks

- Socket.IO integration
- Contest rooms
- Host room
- Participant rooms
- Station rooms
- Round events
- Status events
- Technical events
- Result events
- Redis live state

### Deliverable

Real-time Host dashboard and participant synchronization.

---

# Phase 9 – Anti-Cheat System

### Objective

Implement competition integrity controls.

### Tasks

- Tab switch detection
- Window blur detection
- Copy detection
- Paste detection
- Cut detection
- Context-menu detection
- Refresh detection
- Navigation detection
- Fullscreen monitoring
- Multiple-session detection
- Unauthorized station detection
- Restart attempt detection
- Violation logging
- Automatic DQ where configured

### Deliverable

Complete anti-cheat monitoring and Host intervention system.

---

# Phase 10 – Results and Judging

### Objective

Give the Host complete judging functionality.

### Tasks

- Live scores
- Round 1 ranking
- Qualification list
- Round 2 ranking
- Final ranking
- Tie-breaking
- Violation review
- Technical incident review
- Manual Host actions
- Contest finalization

### Deliverable

Host-only judging and results system.

---

# Phase 11 – Audit and Recovery

### Objective

Make the system suitable for an actual event.

### Tasks

- Audit logs
- Database backups
- Recovery procedures
- Technical interruption handling
- Session transfer
- Server restart recovery
- Browser refresh recovery
- Result integrity verification

### Deliverable

Reliable event recovery system.

---

# Phase 12 – Kiosk and Lab Deployment

### Objective

Prepare the 50 physical computers.

### Tasks

- Standardize browsers
- Configure kiosk mode
- Configure station identifiers
- Disable unnecessary extensions
- Disable notifications
- Verify keyboard layouts
- Configure competition URL
- Test LAN connectivity
- Test every computer

### Deliverable

50 competition-ready stations.

---

# Phase 13 – Load and Failure Testing

### Objective

Simulate the actual event.

### Tests

- 50 simultaneous logins
- 50 simultaneous round starts
- 50 simultaneous submissions
- Multiple simultaneous violations
- Multiple simultaneous disqualifications
- Server restart
- Redis restart
- Database restart
- PC disconnect
- Network disconnect
- Browser refresh
- Browser crash
- Power interruption
- Host restart
- Duplicate login
- Unauthorized station
- Contest lock verification

### Deliverable

Event-readiness test report.

---

# Phase 14 – Full Mock Competition

### Objective

Perform a complete rehearsal.

Simulate:

```text
50 Participants
+
50 PCs
+
1 Host
+
Round 1
+
Qualification
+
Round 2
+
Final Results
```

Measure:

- Server stability
- LAN stability
- UI responsiveness
- Timing accuracy
- Anti-cheat behavior
- Scoring accuracy
- Host workflow
- Recovery procedures

### Deliverable

**Go / No-Go decision**

---

# Phase 15 – Production Deployment

### Objective

Deploy the final system for the actual event.

### Checklist

```text
✓ Server tested
✓ Database backed up
✓ Redis tested
✓ LAN tested
✓ 50 PCs tested
✓ Station IDs verified
✓ Participants imported
✓ Computer assignments verified
✓ Passages locked
✓ Rules frozen
✓ Host account verified
✓ Anti-cheat tested
✓ Recovery plan available
✓ UPS available
✓ Results export tested
```

---

# 52. Recommended Development Order

The most practical implementation sequence is:

```text
Phase 0
Requirements
   ↓
Phase 1
Foundation
   ↓
Phase 2
Authentication
   ↓
Phase 3
Stations
   ↓
Phase 4
Contest Management
   ↓
Phase 5
Passages
   ↓
Phase 6
Typing Engine
   ↓
Phase 7
Contest Engine
   ↓
Phase 8
Real-Time
   ↓
Phase 9
Anti-Cheat
   ↓
Phase 10
Results
   ↓
Phase 11
Recovery
   ↓
Phase 12
Lab Deployment
   ↓
Phase 13
Testing
   ↓
Phase 14
Mock Competition
   ↓
Phase 15
Production
```

---

# 53. Definition of Done

The application is considered ready for the event only when:

### Authentication

- [ ] Host can log in
- [ ] Registered participants can log in
- [ ] Unregistered users are rejected
- [ ] Duplicate participant sessions are blocked

### Stations

- [ ] All 50 stations are identifiable
- [ ] Participant assignments work
- [ ] Unauthorized stations are rejected
- [ ] Heartbeats work
- [ ] Offline stations are detected

### Contest

- [ ] Host can create contest
- [ ] Host can lock contest
- [ ] Host can start Round 1
- [ ] Host can start Round 2
- [ ] Qualification works

### Typing

- [ ] Medium passage works
- [ ] Hard passage works
- [ ] Backspace works
- [ ] Timer works
- [ ] Automatic submission works
- [ ] Refresh does not restart attempt

### Scoring

- [ ] WPM is correct
- [ ] Accuracy is correct
- [ ] Errors are correct
- [ ] Score is correct
- [ ] Tie-break works

### Anti-Cheat

- [ ] Paste detection works
- [ ] Copy detection works
- [ ] Refresh detection works
- [ ] Tab/window events are recorded
- [ ] Restart attempts are blocked
- [ ] Unauthorized sessions are blocked
- [ ] Violations are logged

### Host

- [ ] Live station monitoring works
- [ ] Violations are visible
- [ ] Disqualification works
- [ ] Technical transfer works
- [ ] Results are visible
- [ ] Finalization works
- [ ] Export works

### Reliability

- [ ] Database backup works
- [ ] Browser refresh recovery works
- [ ] PC failure procedure works
- [ ] LAN failure procedure tested
- [ ] Server recovery tested
- [ ] Full 50-PC mock competition completed

---

# 54. Final System Architecture

```text
                         ┌─────────────────────┐
                         │       HOST          │
                         │   React Dashboard   │
                         └──────────┬──────────┘
                                    │
                              Socket.IO
                                    │
              ┌─────────────────────v─────────────────────┐
              │           BLITZKRIEG SERVER              │
              │                                           │
              │ Node.js + TypeScript + Fastify            │
              │                                           │
              │ ┌─────────────┐  ┌────────────────────┐  │
              │ │ Contest     │  │ Anti-Cheat         │  │
              │ │ Engine      │  │ Engine             │  │
              │ └─────────────┘  └────────────────────┘  │
              │                                           │
              │ ┌─────────────┐  ┌────────────────────┐  │
              │ │ Scoring     │  │ Station Manager    │  │
              │ │ Engine      │  │                    │  │
              │ └─────────────┘  └────────────────────┘  │
              │                                           │
              │ ┌─────────────┐  ┌────────────────────┐  │
              │ │ Passage     │  │ Session Manager    │  │
              │ │ Manager     │  │                    │  │
              │ └─────────────┘  └────────────────────┘  │
              └───────────────┬─────────────┬─────────────┘
                              │             │
                       ┌──────v──────┐ ┌────v─────────┐
                       │    Redis    │ │ PostgreSQL   │
                       │ Live State │ │ Authoritative│
                       │ + Pub/Sub  │ │ Data         │
                       └────────────┘ └──────────────┘
                              │
                         COLLEGE LAN
                              │
        ┌─────────────────────┼───────────────────────┐
        │                     │                       │
      PC-01                 PC-02                  PC-50
        │                     │                       │
     BZK001                BZK002                  BZK050
```

---

# 55. Final Product Principles

The final Blitzkrieg implementation should follow these principles:

1. **LAN-first** — the event must work without internet.
2. **Server-authoritative** — the client never determines official results.
3. **Local typing** — keystrokes are processed locally for minimal latency.
4. **Same passage per round** — everyone competes under the same text conditions.
5. **Host-only authority** — there are only Host and Participant roles.
6. **Registered users only** — no public competition access.
7. **Station-aware** — every physical lab computer has a known identity.
8. **Anti-cheat by design** — cheating events are detected, recorded, and acted upon.
9. **Technical failures are distinct from cheating** — the Host can intervene.
10. **Auditable** — important Host actions and participant violations are logged.
11. **Recoverable** — browser, PC, network, and server failures have defined procedures.
12. **Simple infrastructure** — no unnecessary cloud, Kubernetes, or microservices.
13. **Test before event** — a complete 50-PC mock competition is mandatory.
14. **Rules are frozen before production** — scoring and anti-cheat behavior must not change mid-event.

---

## Final Technology Stack

```text
Frontend
├── React
├── TypeScript
├── Vite
├── Tailwind CSS
└── Socket.IO Client

Backend
├── Node.js
├── TypeScript
├── Fastify
└── Socket.IO

Data
├── PostgreSQL
└── Redis

Infrastructure
├── Docker
├── Nginx/Caddy
├── Linux
└── Gigabit Ethernet LAN

Competition
├── Local Passage Bank
├── Server-authoritative Timer
├── Server-side Scoring
├── Anti-Cheat Engine
├── Station Management
└── Host Control Panel
```

---

## Final Outcome

The completed system will allow a single Host to operate a **50-PC typing competition from one dashboard**, while all participants compete simultaneously through the college's local network.

The critical competition path will be:

```text
Participant Login
       ↓
Station Verification
       ↓
System Check
       ↓
Waiting Room
       ↓
Host Starts Round
       ↓
Server Releases Same Passage
       ↓
Local Low-Latency Typing
       ↓
Server-Controlled End Time
       ↓
Automatic Submission
       ↓
Server Scoring
       ↓
Qualification
       ↓
Round 2
       ↓
Final Ranking
       ↓
Host Finalizes Results
       ↓
Export + Backup
```

**The PRD is designed so the application can be built, tested, deployed, and operated entirely within the college laboratory without requiring internet access during the competition.**
