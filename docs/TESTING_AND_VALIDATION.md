# SMART-BASKETBOT — Testing and Validation

**Document ID:** SBB-TEST-2026-FINAL  
**Test Framework:** Vitest v5.0.5  
**Bundler & Build Tool:** Vite v8.3.5  
**Verification Date:** November 4, 2026  
**Status:** 100% Passed (302/302 Tests) | Production Build Succeeded  

---

## 1. Executive Summary

Software quality, mathematical accuracy, and runtime stability of the SMART-BASKETBOT simulator are verified through an automated multi-tier test harness. 

Every mathematical derivation (differential-drive kinematics, PID response, damped ballistic trajectories, A\* graph search), physical collider boundary, sensor threshold, and autonomous state transition is validated through programmatic assertions.

### Verification Key Metrics
- **Automated Test Files:** 18 suites executed, **18 passed (100%)**
- **Automated Tests:** 302 assertions executed, **302 passed (100%)**, 0 failed
- **Test Execution Time:** 2.10 – 3.28 seconds
- **Production Build:** 57 modules transformed, **0 errors**, build completed in ~696 ms

---

## 2. Test Execution Command & Terminal Output

### Standard Test Command
```bash
npm test
```
*Note: Under restricted Windows PowerShell environments, execute via `cmd.exe /c "npm test"` or `npx vitest run`.*

### Verified Vitest Execution Output
```text
 RUN  v5.0.5 C:/Projects/smart-basketbot-simulator

 ✓ tests/simulation.test.js (9 tests) 15ms
 ✓ tests/analytics.test.js (26 tests) 87ms
 ✓ tests/kinematics.test.js (13 tests) 10ms
 ✓ tests/pid.test.js (14 tests) 11ms
 ✓ tests/differentialDrive.test.js (10 tests) 32ms
 ✓ tests/navigation.test.js (16 tests) 46ms
 ✓ tests/vision.test.js (13 tests) 35ms
 ✓ tests/shooting.test.js (32 tests) 1535ms
 ✓ tests/shootingController.test.js (28 tests) 1371ms
 ✓ tests/autonomy.test.js (26 tests) 42ms
 ✓ tests/autonomousRemediation.test.js (19 tests) 50ms
 ✓ tests/autonomousEndToEnd.test.js (15 tests) 1250ms
 ✓ tests/continuousGameplay.test.js (11 tests) 280ms
 ✓ tests/intermittentNavigationFix.test.js (14 tests) 180ms
 ✓ tests/physicsCorrections.test.js (13 tests) 1250ms
 ✓ tests/ballTrajectoryTracking.test.js (19 tests) 85ms
 ✓ tests/runtimeStability.test.js (16 tests) 45ms
 ✓ tests/systemIntegration.test.js (8 tests) 140ms

 Test Files  18 passed (18)
      Tests  302 passed (302)
   Start at  23:34:28
   Duration  2.10s (tests 73%, import 18%, transform 7%, worker 2%)
```

---

## 3. Detailed Test Suite Breakdown

The 18 test suites cover all mechatronic, algorithmic, and supervisory layers of the simulator:

| # | Test Suite File Path | Subsystem Under Test | Passed / Total | Key Verified Assertions |
| :---: | :--- | :--- | :---: | :--- |
| **1** | `tests/simulation.test.js` | Simulation Core & Config | **9 / 9** | Court dimensions ($28\text{m} \times 15\text{m}$), rim elevation ($3.05\text{m}$), ball mass ($0.62\text{kg}$), Rapier gravity ($[0, -9.81, 0]$). |
| **2** | `tests/kinematics.test.js` | Differential Drive Kinematics | **13 / 13** | Forward/inverse kinematics, zero-radius turn in place, curved arc motion, RPM $\leftrightarrow$ rad/s conversions. |
| **3** | `tests/pid.test.js` | PID Motion Controller | **14 / 14** | Proportional, integral, derivative response, anti-windup accumulator clamping, angular error wrapping across $[-\pi, +\pi]$. |
| **4** | `tests/differentialDrive.test.js` | Chassis Velocity Control | **10 / 10** | Slew-rate velocity ramping ($1.8\text{ m/s}^2$), heading pursuit, emergency stop brake. |
| **5** | `tests/navigation.test.js` | Occupancy Grid & A\* | **16 / 16** | Discretization ($0.25\text{m}$ pitch), $0.42\text{m}$ obstacle inflation, 8-connected search, raycast string-pulling. |
| **6** | `tests/vision.test.js` | Synthetic Vision & Tracking | **13 / 13** | Camera frustum projection ($75^\circ$ FOV), line-of-sight raycasting, distance and azimuth calculations, Kalman smoothing. |
| **7** | `tests/shooting.test.js` | Intake & Flywheel Launcher | **32 / 32** | Optical beam-break gate ($0.45\text{m}$ range), roller spin ($25\text{ rad/s}$), cradle constraint hold, flywheel RPM spin-up. |
| **8** | `tests/shootingController.test.js` | Closed-Loop Shooting | **28 / 28** | Damped ballistic equations, Newton-Raphson flight time solver, apparent rim aperture, adaptive bias feedback. |
| **9** | `tests/autonomy.test.js` | Autonomous Decision Engine | **26 / 26** | 14-state machine transitions, multi-factor utility scoring, timeout guards, recovery routines. |
| **10** | `tests/autonomousRemediation.test.js` | Autonomous Supervisor | **19 / 19** | Unbroken state transitions from `SEARCHING` to `APPROACHING`, `CAPTURING`, `ALIGNING`, and `SHOOTING`. |
| **11** | `tests/autonomousEndToEnd.test.js` | End-to-End Gameplay | **15 / 15** | Target ball ownership, lifecycle tracking, basket verification, continuous multi-ball acquisition. |
| **12** | `tests/continuousGameplay.test.js` | Dynamic Position Shooting | **11 / 11** | Feasibility evaluation from arbitrary court coordinates ($2.2\text{m} \le d \le 9.0\text{m}$), dynamic reacquisition. |
| **13** | `tests/intermittentNavigationFix.test.js` | Perception-Navigation Link | **14 / 14** | Target lock hysteresis persistence, non-blocking path planning, edge-of-court recovery. |
| **14** | `tests/physicsCorrections.test.js` | Hoop Rim Collision Geometry | **13 / 13** | 16-segment compound rotated rim collider, clearance check ($>0.426\text{m}$), zero inward collision artifacts. |
| **15** | `tests/ballTrajectoryTracking.test.js` | 3D Ball Trajectory Tracker | **19 / 19** | Center-of-mass sampling from Rapier rigid body, speed sampling, 3D ribbon rendering, clear path routine. |
| **16** | `tests/runtimeStability.test.js` | UI & Subsystem Interfaces | **16 / 16** | `AdaptiveShotCorrector` method contracts, SVG NaN render guards, `VisionManager` JSON telemetry safety. |
| **17** | `tests/analytics.test.js` | Simulation Analytics | **26 / 26** | Shooting accuracy %, path efficiency %, motion tracking error buffers, CSV/JSON serialization. |
| **18** | `tests/systemIntegration.test.js` | Full System Lifecycle | **8 / 8** | Application bootstrap, clean reset consistency, physics-to-mesh transform sync at 60 Hz. |

---

## 4. Production Build Verification

The application is compiled for production using Vite:

### Build Command
```bash
npm run build
```

### Verified Build Output
```text
> smart-basketbot-simulator@0.0.0 build
> vite build

vite v8.3.5 building client environment for production...
transforming...
✓ 57 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                     0.77 kB │ gzip:     0.43 kB
dist/assets/index-NQN989MX.css     15.33 kB │ gzip:     3.68 kB
dist/assets/index-Gd-vzNxg.js   5,417.76 kB │ gzip: 1,952.51 kB

[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 696ms
```

### Build Audit Findings
- **Compilation Status:** **SUCCESS** (0 compilation errors, 0 runtime syntax errors).
- **Module Count:** 57 modules transformed.
- **Output Artifacts:** `dist/index.html`, `dist/assets/index-*.css`, and `dist/assets/index-*.js`.
- **Chunk Size Notice:** Vite emits a standard advisory regarding chunk size ($5.4\text{ MB}$, gzipped $1.95\text{ MB}$). This bundle contains Three.js, Rapier3D WebAssembly binaries, and Chart.js packaged into a single, self-contained client executable for offline, zero-install execution.

---

## 5. Major Testing Categories

### 5.1 Algorithmic Unit Tests
- **Kinematics & PID:** Verified forward/inverse velocity conversions and anti-windup behavior under continuous step errors.
- **Ballistic Solver:** Verified Newton-Raphson convergence across launch distances from $2.0\text{m}$ to $10.0\text{m}$ with simulated air drag ($\gamma = 0.08\text{ s}^{-1}$).
- **Occupancy Grid & A\*:** Verified that paths avoid inflated obstacle cells and that raycast string pulling prunes redundant collinear waypoints.

### 5.2 Physics & Contact Validation
- **16-Segment Hoop Rim Collider:** Verified by simulating basketball drops directly through the rim opening. Clean drops pass through with zero contacts, and angled shots deflect realistically off segment tangential colliders.
- **Intake & Optical Sensing:** Tested optical beam-break trigger thresholds ($0.45\text{m}$) and confirmed that ball colliders latch into the cradle constraint upon capture.

### 5.3 Autonomous Gameplay & Fault Recovery
- **Continuous Gameplay Cycle:** Verified the complete loop: `SEARCHING` $\to$ `APPROACHING` $\to$ `CAPTURING` $\to$ `ALIGNING` $\to$ `SPINNING_UP` $\to$ `SHOOTING` $\to$ `VERIFYING` $\to$ `SEARCHING`.
- **Fault Recovery:** Verified that when a ball is trapped against the court boundary or path planning is blocked, the supervisor triggers the `RECOVERING` state, executes a $-1.2\text{m}$ reverse, and re-evaluates alternate targets without freezing.

### 5.4 Regression & Runtime Stability
- Verified that all five historical defects (DEF-01 through DEF-05) remain permanently resolved with dedicated regression test assertions.
