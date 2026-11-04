# SMART-BASKETBOT — User Guide & Operator Manual

**Document ID:** SBB-USER-2026-FINAL  
**System:** SMART-BASKETBOT Autonomous Robotics Basketball Simulator  
**Audience:** Operators, Researchers, Students, and Evaluators  

---

## 1. Quick Start & Installation

### 1.1 Prerequisites
Before running the simulator, ensure your system has:
- **Node.js:** v18.0.0 or higher ([Download Node.js](https://nodejs.org/))
- **npm:** v9.0.0 or higher
- **Web Browser:** Any modern web browser with WebGL 2.0 and WebAssembly support (Google Chrome, Mozilla Firefox, Microsoft Edge, or Safari 16+)
- **Graphics Acceleration:** Hardware acceleration enabled in browser settings for optimal 60 FPS performance.

### 1.2 Installation Steps
Clone the repository and install dependencies:
```bash
# 1. Clone the project repository
git clone https://github.com/NeilGogy06/smart-basketbot-simulator.git
cd smart-basketbot-simulator

# 2. Install NPM dependencies
npm install
```

*Windows PowerShell Troubleshooting Note:* If you encounter an execution policy restriction (`npm.ps1 cannot be loaded`), launch commands through standard command prompt:
```cmd
cmd.exe /c "npm install"
```

### 1.3 Running the Simulator
To start the Vite local development server:
```bash
npm run dev
```
Open your browser and navigate to the displayed local server URL (typically `http://localhost:5173/`).

### 1.4 Production Build & Local Preview
To compile optimized production assets and preview the build:
```bash
# Compile minified production bundle
npm run build

# Preview production build locally
npm run preview
```

---

## 2. Interface Overview

The simulator interface is divided into functional control zones:

```
+-----------------------------------------------------------------------------------------+
|                                    TOP TOOLBAR                                          |
|  [SIMULATION: Start | Pause | Reset All]  [OBJECTS: Reset Ball | Reset Robot | Drop Test]  |
|  [TRAJECTORY: Clear Path]                 [CAMERAS: Overview (1) | Robot (2) | Hoop (3)...] |
+-----------------------------------------------------------------------------------------+
|                                                                                         |
|                                                                    +--------------------+
|                                                                    | HUD AUTONOMY CARD  |
|                                                                    | - Start Continuous |
|                                                                    | - Start Target (5) |
|                                                                    | - Pause / Resume   |
|                                3D VIEWPORT                         | - Stop Autonomy    |
|                          (Interactive Orbit View)                  +--------------------+
|                                                                    | HUD TELEMETRY      |
|                                                                    | - FSM State        |
|                                                                    | - Robot Velocity   |
|                                                                    | - Ball Distance    |
|                                                                    | - 2D Court Radar   |
|                                                                    +--------------------+
+-----------------------------------------------------------------------------------------+
|                             ANALYTICS & CHARTS PANEL                                    |
|  [Overview] [Shooting Accuracy] [Launch Velocities] [State Dwell Times]  [Export CSV/JSON] |
+-----------------------------------------------------------------------------------------+
```

1. **Top Toolbar:** Houses global simulation lifecycle buttons (Play, Pause, Reset All), physical drop tests, trajectory path clearing, and 4 one-click camera perspective presets.
2. **Interactive 3D Viewport:** Hardware-accelerated Three.js canvas. Left-click and drag to rotate the camera; right-click and drag to pan; scroll wheel to zoom in/out.
3. **Cockpit HUD Overlay:** Displays live telemetry gauges, 2D radar court display, detected target reticles, camera frustum indicators, and current finite state machine status.
4. **Autonomy Control Panel:** Dedicated controls to initiate continuous autonomous gameplay, configure target basket goals, and halt autonomous routines.
5. **Analytics & Performance Charts:** Interactive Chart.js graphs displaying real-time shooting accuracy %, launch velocity distributions, and session telemetry export buttons.

---

## 3. Verified Controls Reference

The simulator supports both manual teleoperation and fully autonomous gameplay:

### 3.1 Keyboard Teleoperation Controls

| Key / Shortcut | Subsystem Actuated | Operational Behavior |
| :---: | :--- | :--- |
| **`W` / `Up Arrow`** | Differential Drive Base | Drive robot forward at linear speed ($1.6\text{ m/s}$). |
| **`S` / `Down Arrow`** | Differential Drive Base | Drive robot in reverse at linear speed ($-1.6\text{ m/s}$). |
| **`A` / `Left Arrow`** | Differential Drive Base | Turn robot counter-clockwise (left) in place at $2.4\text{ rad/s}$. |
| **`D` / `Right Arrow`** | Differential Drive Base | Turn robot clockwise (right) in place at $2.4\text{ rad/s}$. |
| **`Space`** | Emergency Interlock | **Emergency Stop (E-Stop):** Instantly zeroes drive velocity commands. |
| **`F`** | Shooting Mechanism | **Fire Shooter:** Spins up flywheels and launches basketball toward target hoop. |
| **`I`** | Intake Mechanism | **Toggle Intake:** Cycles roller state (Intake Forward $\to$ Off $\to$ Reject). |
| **`P`** | Simulation Clock | **Play / Pause:** Toggles fixed 60 Hz physics stepping. |
| **`R`** | Lifecycle Coordinator | **Reset All:** Resets robot, basketball, colliders, and state machine to start pose. |
| **`B`** | Environment Subsystem | **Reset Ball:** Teleports basketball to its initial court coordinates. |
| **`T`** | Physics Test Harness | **Drop Test:** Drops basketball from $3.2\text{m}$ elevation to verify restitution bounce. |
| **`Y`** | 3D Trajectory Ribbon | **Toggle Trajectory Line:** Shows or hides the real-time 3D ball flight path. |
| **`X`** | 3D Trajectory Ribbon | **Clear Trajectory Path:** Clears all recorded 3D flight waypoints from memory. |
| **`1`** | Camera System | **Camera Preset 1:** Switches to Court Perspective Overview. |
| **`2`** | Camera System | **Camera Preset 2:** Switches to Robot Orbit Follow View. |
| **`3`** | Camera System | **Camera Preset 3:** Switches to Target Hoop Focus View. |
| **`4`** | Camera System | **Camera Preset 4:** Switches to Tactical Orthogonal Top-Down View. |

---

## 4. How to Operate the Simulator

### 4.1 Manual Teleoperation Walkthrough
1. Click the **Start** button on the top toolbar (or press `P`) to ensure the physics simulation is active.
2. Use `W`, `A`, `S`, `D` to maneuver the robot toward a basketball.
3. As you approach within $0.45\text{m}$ of the ball, press `I` to engage the front intake rollers.
4. Drive forward into the ball. The rollers pull the ball into the cradle, breaking the simulated optical beam. The HUD indicator changes to `POSSESSION: CAPTURED`.
5. Rotate the robot to face the target hoop at the far end of the court.
6. Press `F` to spin up the flywheels and fire the ball toward the hoop.
7. Observe the green 3D trajectory line tracking the ball's physical center of mass in flight.

### 4.2 Autonomous Continuous Gameplay Walkthrough
To experience the robot playing completely autonomously:
1. Ensure the simulation is running (top toolbar shows `PAUSE` button active).
2. On the right-hand HUD Autonomy card, click **Start Continuous**.
3. **Observe Autonomous Execution:**
   - The robot transitions to **`SEARCHING`** and rotates in place to scan for basketballs using its synthetic camera frustum.
   - Upon detecting candidate balls, the multi-factor utility engine selects the best target and transitions to **`APPROACHING`**.
   - A bright green 3D ribbon appears on the court surface showing the **A\* planned path** smoothed via raycast string-pulling.
   - The robot traverses the path, decelerating as it reaches the ball.
   - Upon entering capture range, the robot transitions to **`CAPTURING`**, runs its intake rollers, and latches the ball.
   - The HUD confirms **`POSSESSION: CAPTURED`**, and the robot transitions to **`ALIGNING`**, turning in place to aim directly at the hoop rim center ($< 2^\circ$ error).
   - The robot calculates launch parameters via the Newton-Raphson ballistic solver, enters **`SPINNING_UP`**, accelerates flywheels, and enters **`SHOOTING`**.
   - The ball launches along a high arc ($\theta_{\text{entry}} \ge 32^\circ$), scoring cleanly through the 16-segment hoop rim collider.
   - The net trigger registers the basket, the analytics engine records the goal, and the robot immediately enters **`REACQUIRING`** to locate the next basketball.
4. **Pause or Stop:**
   - Click **Pause Autonomy** to freeze the autonomous decision loop without resetting accumulated stats.
   - Click **Stop Autonomy** to cancel the session and immediately return the robot to manual standby.

### 4.3 Fixed Target Mode Walkthrough
1. In the input box on the Autonomy card, enter a target goal count (e.g. `3` or `5`).
2. Click **Start Target Mode**.
3. The robot executes continuous autonomous cycles until the specified number of successful baskets has been scored.
4. Upon reaching the goal count, the supervisor transitions to **`COMPLETED`** and halts all motors.

---

## 5. Interpreting Analytics & Telemetry

### 5.1 HUD Gauges & Radar Display
- **Linear Velocity Gauge:** Real-time forward/reverse speed of the robot chassis in m/s.
- **Angular Velocity Gauge:** Real-time yaw rotation rate in rad/s.
- **2D Court Radar:** Displays the robot's relative court position, heading cone, and detected basketball coordinates relative to the court perimeters.
- **FSM State Banner:** Prominently displays the active autonomous state (e.g. `NAVIGATING_TO_BALL`, `ALIGNING_WITH_HOOP`).

### 5.2 Performance Charts
Click the tabs in the bottom analytics panel:
- **Shooting Accuracy Tab:** Dynamic bar chart showing total attempts, successful baskets, and conversion rate %.
- **Launch Dynamics Tab:** Scatter plot correlating launch velocity (m/s) against shot distance (m) with theoretical ballistic curves.
- **Autonomy Dwell Time Tab:** Bar chart visualizing the percentage of time spent in each autonomous operational state.

### 5.3 Exporting Session Data
To export performance telemetry for external analysis in Python, MATLAB, or Excel:
- Click **Export JSON** to download the structured session dataset including timestamps, flight times, launch speeds, and state transitions.
- Click **Export CSV** to download tabular shot logs.
- Click **Reset Analytics** to clear session records.

---

## 6. Troubleshooting Common Issues

| Issue / Symptom | Probable Cause | Corrective Action |
| :--- | :--- | :--- |
| **Robot does not respond to `W/A/S/D`** | Simulation is paused or autonomous mode is active. | Press `P` to resume simulation, or click **Stop Autonomy** to return control to manual teleoperation. |
| **Low frame rate ($\le 30\text{ FPS}$)** | Browser hardware acceleration is disabled. | Open browser settings, enable *Use graphics acceleration when available*, and restart browser. |
| **Ball bounces off invisible edge near rim** | Historical axis-aligned colliders in old build. | Ensure latest build is active (`BasketballHoop.js` utilizes 16-segment compound rotated rim geometry). |
| **Robot turns away and loses target ball** | Camera swept past ball during initial turn. | System includes a 3.0s target persistence latch; allow robot to complete recovery reverse maneuver. |
| **NPM scripts blocked on Windows** | PowerShell execution policy restriction. | Execute commands via `cmd.exe /c "npm run dev"` or adjust PowerShell policy (`Set-ExecutionPolicy -Scope Process Bypass`). |
