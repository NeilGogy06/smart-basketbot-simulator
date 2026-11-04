# SMART-BASKETBOT Simulator — Milestone 5 Implementation Report
## Autonomous Shooting Accuracy, Trajectory Optimization & Closed-Loop Control

---

## 1. Executive Summary

Milestone 5 establishes an analytical, physically validated, closed-loop shooting subsystem for the SMART-BASKETBOT mobile robotics platform. Building on the differential-drive kinematic foundation, A* path planning, front roller intake, and dual-flywheel launcher developed in prior milestones, Milestone 5 implements:
1. **Kinematic Trajectory Optimization**: Real-time evaluation of ballistic parameter sweeps that maximize the effective rim opening ellipse and guarantee descending entry under Rapier 3D rigid-body gravity.
2. **Dedicated Closed-Loop Controller (`ClosedLoopShootingController`)**: A coordinated state machine orchestrating pose measurement, trajectory selection, heading hold PID alignment, flywheel speed ramp-up, interlock validation, and firing.
3. **Deterministic Adaptive Feedback (`AdaptiveShotCorrector`)**: A bounded integral feedback control law that classifies physical miss outcomes (`SCORED`, `MISSED_SHORT`, `MISSED_LONG`, `MISSED_LEFT`, `MISSED_RIGHT`) and adaptively shifts launch speed, elevation angle, and yaw heading biases to converge upon high-percentage shooting accuracy without pseudo-random heuristics or machine learning.
4. **Enhanced Telemetry & Shot History**: Real-time dashboard readouts for target distance, alignment error, optimal launch parameters, flight time, apex height, rim clearance margin, adaptive calibration biases, and rolling historical shot results.

All 122 automated unit, integration, and physics tests pass cleanly across 7 test suites. The production bundle builds with zero errors.

---

## 2. Mathematical & Kinematic Formulations

### 2.1 Projectile Motion & Launch Velocity Calculation
Given the initial ball launch position $\mathbf{p}_0 = (x_0, y_0, z_0)$ at the launcher muzzle and target hoop center $\mathbf{p}_{\text{rim}} = (x_t, y_t, z_t)$, the horizontal displacement $d$ and vertical displacement $h$ are:
$$d = \sqrt{(x_t - x_0)^2 + (z_t - z_0)^2}$$
$$h = y_t - y_0$$

For a chosen launch elevation angle $\theta$, the ballistic flight equations governed by gravitational acceleration $g = 9.81\text{ m/s}^2$ without drag yield:
$$x(t) = (v_0 \cos\theta) t$$
$$y(t) = y_0 + (v_0 \sin\theta) t - \frac{1}{2} g t^2$$

Substituting $t = \frac{d}{v_0 \cos\theta}$ into the vertical displacement equation gives:
$$h = d \tan\theta - \frac{g d^2}{2 v_0^2 \cos^2\theta}$$

Solving for required initial velocity magnitude $v_0$:
$$v_0 = \sqrt{\frac{g d^2}{2 \cos^2\theta (d \tan\theta - h)}}$$

#### Descending Entry Physical Constraint
A positive, physically real velocity requires $d \tan\theta - h > 0$, or $\tan\theta > \frac{h}{d}$ (line-of-sight angle). However, for a basketball to enter a horizontal rim from above rather than grazing the front lip on an ascending path, the vertical arrival velocity at $t = t_f$ must be downward:
$$v_{y}(t_f) = v_0 \sin\theta - g t_f < 0$$
Since $t_f = \frac{d}{v_0 \cos\theta}$:
$$v_0 \sin\theta < \frac{g d}{v_0 \cos\theta} \implies v_0^2 \sin\theta \cos\theta < g d$$
Substituting $v_0^2 = \frac{g d^2}{2 \cos^2\theta (d \tan\theta - h)}$:
$$\frac{g d^2 \sin\theta \cos\theta}{2 \cos^2\theta (d \tan\theta - h)} < g d \implies \frac{d \tan\theta}{2(d \tan\theta - h)} < 1 \implies d \tan\theta > 2h$$
Thus, descending entry strictly requires:
$$\tan\theta > \frac{2h}{d} \iff \theta > \text{atan2}(2h, d)$$

For standard regulation free-throw geometry ($d = 4.225\text{ m}$, $h = 3.05 - 0.45 = 2.60\text{ m}$):
- Line-of-sight angle: $\theta_{\text{los}} = \arctan(2.60 / 4.225) \approx 31.6^\circ$
- Minimum descending entry launch angle: $\theta_{\text{desc}} = \arctan(5.20 / 4.225) \approx 50.9^\circ$
Any trajectory launched below $50.9^\circ$ arrives moving upward or flat, making direct rim entry impossible.

### 2.2 Entry Angle & Apparent Rim Aperture Kinematics
At the target hoop plane ($t = t_f = \frac{d}{v_0 \cos\theta}$), the velocity components are:
$$v_{x, \text{entry}} = v_0 \cos\theta, \quad v_{y, \text{entry}} = v_0 \sin\theta - g t_f$$
The entry angle $\theta_{\text{entry}}$ below horizontal is:
$$\theta_{\text{entry}} = \arctan\left(\frac{-v_{y, \text{entry}}}{v_{x, \text{entry}}}\right)$$

Regulation basketball rim diameter $D_{\text{rim}} = 0.45\text{ m}$ and basketball diameter $D_{\text{ball}} = 0.24\text{ m}$. Viewed along the descent vector inclined at angle $\theta_{\text{entry}}$, the circular rim projects an apparent elliptical aperture with minor diameter $D_{\text{eff}}$:
$$D_{\text{eff}} = D_{\text{rim}} \sin(\theta_{\text{entry}})$$

The radial rim clearance margin $\Delta_{\text{clear}}$ is:
$$\Delta_{\text{clear}} = D_{\text{eff}} - D_{\text{ball}} = 0.45 \sin(\theta_{\text{entry}}) - 0.24\text{ [m]}$$

To clear the rim with positive margin ($\Delta_{\text{clear}} > 0$):
$$\sin(\theta_{\text{entry}}) > \frac{0.24}{0.45} \approx 0.533 \implies \theta_{\text{entry}} > 32.23^\circ$$

### 2.3 Candidate Trajectory Optimization Metric
The `TrajectoryCalculator` sweeps candidate launch angles from $48^\circ$ to $68^\circ$ in $1.0^\circ$ increments, filtering out non-viable solutions ($v_0 < 4.0\text{ m/s}$, $v_0 > 15.0\text{ m/s}$, apex height $> 7.0\text{ m}$, $\theta_{\text{entry}} < 34.0^\circ$). Surviving candidates are ranked by an objective scoring function:
$$\text{Score}(\theta) = 2.5 \cdot \theta_{\text{entry}} + 100.0 \cdot \Delta_{\text{clear}} - 0.8 \cdot v_0$$
- **$+2.5 / ^\circ$**: Steep descent reward (dramatically opens apparent rim ellipse).
- **$+100.0\text{ m}^{-1}$**: Radial clearance reward (maximizes tolerance for minor positional errors).
- **$-0.8\text{ s/m}$**: Flywheel kinetic velocity penalty (minimizes ball skin friction, slippage, and chassis recoil).

The candidate trajectory yielding the maximum score is selected as the nominal shot command.

---

## 3. Subsystem Architecture & Controller Coordination

```
                                  +-------------------------------------+
                                  |         HoopDetector (3D)           |
                                  | Tracks ball penetration, min dist,  |
                                  | rim plane crossing, and outcomes    |
                                  +------------------+------------------+
                                                     |
                                                     | Shot details: SCORED /
                                                     | MISSED_SHORT / LONG / LEFT / RIGHT
                                                     v
+-------------------------------+         +-------------------------------------+
|      RobotKinematics          |         |       AdaptiveShotCorrector         |
|  Normalizes yaw errors and   |-------->| Bounded integral feedback offsets:  |
|  body transform coordinates   |         | Delta_v, Delta_elev, Delta_yaw      |
+---------------+---------------+         +------------------+------------------+
                |                                            |
                | Live pose (x, y, z, yaw)                   | Bias adjustments
                v                                            v
+-------------------------------------------------------------------------------+
|                        ClosedLoopShootingController                           |
|  States: IDLE -> OPTIMIZING -> ALIGNING -> SPINNING_UP -> READY -> FIRING     |
+---------------------------------------+---------------------------------------+
                                        |
                 +----------------------+----------------------+
                 |                                             |
                 v                                             v
+----------------------------------+         +----------------------------------+
|    DifferentialDriveController   |         |        ShootingMechanism         |
| Active: HEADING_HOLD PID         |         | Dual flywheels ramped to target  |
| NavController cancelled (No      |         | RPM. Interlock: verified genuine |
| controller contention)           |         | intake cradle ball possession    |
+----------------------------------+         +----------------------------------+
```

### 3.1 Controller Contention Prevention
A major challenge in mobile robotics simulation is dual-controller conflict: when autonomous navigation (`AutonomousNavController`) commands linear/angular velocities simultaneously with the shooting controller (`ClosedLoopShootingController`). 

To eliminate contention:
1. `ClosedLoopShootingController.startShootingSequence()` explicitly invokes `this.robot.navController.cancel()`.
2. The robot's control mode is switched to dedicated heading stabilization.
3. The differential drive PID controller dedicates 100% of available wheel torque to pure in-place yaw rotation until $|\Delta\psi| \le 0.035\text{ rad}$ ($\approx 2.0^\circ$).

### 3.2 Possession Interlock Mechanism
To prevent phantom firing, flywheel spin-up or launch commands are hard-interlocked:
- Shooting requires `robot.intake.isBallCaptured === true`.
- If ball possession is lost at any point during trajectory optimization, alignment, or flywheel spin-up, the controller immediately aborts to `FAILED` and halts flywheel rotation.

---

## 4. Deterministic Adaptive Shot Correction

Rather than utilizing black-box machine learning or stochastic reinforcement learning, the system employs a deterministic adaptive feedback control law (gain scheduling with bounded integral correction):

```
Physical Trajectory ---> Ball Crosses Rim/Floor Plane ---> HoopDetector Classification
                                                                   |
+------------------------------------------------------------------+
|
+--> SCORED:       Delta_v *= 0.85, Delta_psi *= 0.85 (bias damping toward zero)
+--> MISSED_SHORT: Delta_v += +0.15 m/s, Delta_elev += +0.5 deg
+--> MISSED_LONG:  Delta_v -= +0.15 m/s, Delta_elev -= +0.5 deg
+--> MISSED_LEFT:  Delta_psi -= 0.015 rad (steer counter-clockwise / right)
+--> MISSED_RIGHT: Delta_psi += 0.015 rad (steer clockwise / left)
```

### 4.1 Anti-Windup Saturation Bounds
To maintain mathematical stability and prevent integral windup from accumulating unreasonable biases:
- **Velocity Bias Clamp**: $\Delta v \in [-1.5\text{ m/s}, +1.5\text{ m/s}]$
- **Elevation Bias Clamp**: $\Delta\theta \in [-3.0^\circ, +3.0^\circ]$
- **Yaw Heading Bias Clamp**: $\Delta\psi \in [-0.06\text{ rad}, +0.06\text{ rad}]$ ($\approx \pm 3.4^\circ$)

When a shot scores, an exponential decay factor ($\kappa = 0.85$) is applied to all active biases:
$$\mathbf{b}_{k+1} = \kappa \mathbf{b}_k$$
This ensures the controller settles symmetrically around optimal nominal values without persistent positive or negative drift.

---

## 5. Summary of Files Created and Modified

| File Path | Status | Key Implementations & Enhancements |
|---|---|---|
| [`src/robot/TrajectoryCalculator.js`](file:///C:/Projects/smart-basketbot-simulator/src/robot/TrajectoryCalculator.js) | Modified | Added physical suitability validation ($d\tan\theta > 2h$, $y_{\text{apex}} > y_{\text{rim}}$), entry angle kinematics, apparent rim ellipse diameter ($D_{\text{eff}} = D_{\text{rim}}\sin\theta_{\text{entry}}$), radial margin calculation, `evaluateCandidateTrajectories`, and `optimizeTrajectory`. |
| [`src/robot/HoopDetector.js`](file:///C:/Projects/smart-basketbot-simulator/src/robot/HoopDetector.js) | Modified | Added closest point of approach tracking, rim-height penetration registration, detailed miss outcome classification (`MISSED_SHORT`, `MISSED_LONG`, `MISSED_LEFT`, `MISSED_RIGHT`), 20-shot rolling history log, and backward-compatible getters/setters. |
| [`src/robot/AdaptiveShotCorrector.js`](file:///C:/Projects/smart-basketbot-simulator/src/robot/AdaptiveShotCorrector.js) | Created | Implemented bounded integral feedback adaptation rules, directional bias correction, saturation clamping, bias decay on scored baskets, and telemetry export. |
| [`src/robot/ClosedLoopShootingController.js`](file:///C:/Projects/smart-basketbot-simulator/src/robot/ClosedLoopShootingController.js) | Created | Standalone closed-loop shooting coordinator with interlocked state machine (`IDLE` $\rightarrow$ `OPTIMIZING` $\rightarrow$ `ALIGNING` $\rightarrow$ `SPINNING_UP` $\rightarrow$ `READY` $\rightarrow$ `FIRING` $\rightarrow$ `COOLDOWN` $\rightarrow$ `COMPLETED`), timeout fail-safes, and controller contention isolation. |
| [`src/robot/Robot.js`](file:///C:/Projects/smart-basketbot-simulator/src/robot/Robot.js) | Modified | Added `initShootingController`, `startClosedLoopShooting`, `cancelClosedLoopShooting`, and integration of trajectory calculator and adaptive corrector into telemetry stream. |
| [`src/navigation/AutonomousShooterWorkflow.js`](file:///C:/Projects/smart-basketbot-simulator/src/navigation/AutonomousShooterWorkflow.js) | Modified | Integrated `TrajectoryCalculator` and `AdaptiveShotCorrector` into workflow; updated alignment to include adaptive heading bias; fed trajectory results into corrector; exposed comprehensive workflow telemetry. |
| [`src/simulation/Simulation.js`](file:///C:/Projects/smart-basketbot-simulator/src/simulation/Simulation.js) | Modified | Initialized `robot.initShootingController`, added delegating methods `startClosedLoopShooting` and `cancelClosedLoopShooting`, broadcasted closed-loop telemetry. |
| [`src/ui/Dashboard.js`](file:///C:/Projects/smart-basketbot-simulator/src/ui/Dashboard.js) | Modified | Added ballistic trajectory telemetry readouts (target dist, align error, launch angle, flywheel RPM, flight time, apex height, entry angle, rim margin), adaptive bias indicators, detailed shot outcome badges, and dynamic 5-shot history list. |
| [`src/style.css`](file:///C:/Projects/smart-basketbot-simulator/src/style.css) | Modified | Added styles for recent shot history list, scored/missed left borders, and adaptive bias bar. |
| [`tests/shootingController.test.js`](file:///C:/Projects/smart-basketbot-simulator/tests/shootingController.test.js) | Created | Comprehensive Vitest suite with 28 automated unit and integration tests covering trajectory optimization, apparent rim aperture, HoopDetector classification, AdaptiveShotCorrector feedback, and ClosedLoopShootingController state transitions. |

---

## 6. Automated Test Results

Test execution was performed via `npm.cmd test`:

```
 RUN  v5.0.5 C:/Projects/smart-basketbot-simulator

 ✓ tests/kinematics.test.js (13 tests) 17ms
 ✓ tests/pid.test.js (14 tests) 11ms
 ✓ tests/navigation.test.js (16 tests) 40ms
 ✓ tests/simulation.test.js (9 tests) 280ms
 ✓ tests/differentialDrive.test.js (10 tests) 260ms
 ✓ tests/shooting.test.js (32 tests) 727ms
 ✓ tests/shootingController.test.js (28 tests) 591ms

 Test Files  7 passed (7)
      Tests  122 passed (122)
   Start at  02:56:18
   Duration  1.39s (tests 62%, import 23%, transform 12%, worker 3%)
```

### Milestone 5 Test Breakdown (`tests/shootingController.test.js`)
- **TrajectoryCalculator & Apparent Rim Aperture Kinematics (5 tests)**:
  - Validates candidate evaluation across angle sweep ($48^\circ - 68^\circ$).
  - Validates rejection of shallow ascending entry angles ($d\tan\theta \le 2h$).
  - Validates apparent rim opening ellipse calculation ($D_{\text{eff}} = D_{\text{rim}}\sin\theta_{\text{entry}}$) and clearance margin.
  - Validates optimal trajectory selection prioritizing entry steepness and margin.
  - Validates graceful handling of unreachable targets.
- **HoopDetector Outcome Classification (7 tests)**:
  - Validates initialization with empty history.
  - Validates downward rim penetration scoring.
  - Validates `MISSED_SHORT` classification ($\Delta x < -0.15\text{ m}$).
  - Validates `MISSED_LONG` classification ($\Delta x > +0.18\text{ m}$).
  - Validates `MISSED_LEFT` classification ($\Delta z > +0.14\text{ m}$).
  - Validates `MISSED_RIGHT` classification ($\Delta z < -0.14\text{ m}$).
  - Validates 20-shot rolling history retention with complete metadata.
- **AdaptiveShotCorrector Bounded Integral Feedback (7 tests)**:
  - Validates velocity bias increment on `MISSED_SHORT` (+0.25 m/s).
  - Validates velocity bias decrement on `MISSED_LONG` (-0.25 m/s).
  - Validates heading adjustments for `MISSED_LEFT` and `MISSED_RIGHT`.
  - Validates exponential bias decay upon `SCORED` baskets.
  - Validates strict saturation clamping at $\pm 1.5\text{ m/s}$ and $\pm 0.06\text{ rad}$.
  - Validates application of biases to nominal trajectory parameters.
  - Validates clean reset.
- **ClosedLoopShootingController Execution & Interlocks (6 tests)**:
  - Validates initial `IDLE` state.
  - Validates shot rejection when ball is not captured in intake cradle.
  - Validates cancellation of autonomous navigation controller on start.
  - Validates sequential progression: `OPTIMIZING` $\rightarrow$ `ALIGNING` $\rightarrow$ `SPINNING_UP` $\rightarrow$ `READY` $\rightarrow$ `COOLDOWN` $\rightarrow$ `COMPLETED`.
  - Validates `FAILED` transition upon alignment timeout.
  - Validates clean cancellation.
- **AutonomousShooterWorkflow Integration (3 tests)**:
  - Validates trajectory optimization with adaptive bias incorporation.
  - Validates recording of completed shot outcome into corrector.
  - Validates complete closed-loop telemetry object exposure.

---

## 7. Production Build Status

Build verification was conducted via `npm.cmd run build`:

```
> smart-basketbot-simulator@0.0.0 build
> vite build

vite v8.3.5 building client environment for production...
transforming...
✓ 35 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                     0.77 kB │ gzip:     0.42 kB
dist/assets/index-Bn4hkbRC.css     11.61 kB │ gzip:     3.00 kB
dist/assets/index-u2P88oep.js   5,047.16 kB │ gzip: 1,845.39 kB
✓ built in 407ms
```

Bundle completed cleanly with zero syntax errors, type conflicts, or broken asset paths.

---

## 8. Physical Limitations and Simulation Fidelity

1. **Analytical Projectile Equations vs. Physics Discrete Time Stepping**:
   - The trajectory calculator computes continuous parabolic motion ($y(t) = y_0 + v_{y0}t - \frac{1}{2}gt^2$).
   - Rapier 3D integrates equations of motion using discrete semi-implicit Euler integration at $\Delta t = \frac{1}{60}\text{ s}$ ($16.67\text{ ms}$).
   - At velocities around $8.5\text{ m/s}$, the ball travels $\approx 14.1\text{ cm}$ per physics time-step. To prevent tunneling through the rim ring collider ($d_{\text{tube}} \approx 2\text{ cm}$), Continuous Collision Detection (CCD) is permanently enabled on the basketball rigid body (`basketball.rigidBody.enableCcd(true)`).
2. **Aerodynamics & Magnus Effect**:
   - The current physics world models rigid-body gravity and restitution. Atmospheric drag and the backspin Magnus effect (which in real basketball creates aerodynamic lift and steepens descent) are not simulated by default Rapier rigid body physics.
   - The adaptive corrector compensates for this discrepancy by empirically trimming launch velocity and elevation angle based on actual observed rim penetration coordinates.
3. **Restitution Dynamics (Backboard and Rim Springs)**:
   - Real basketball rims feature release springs and flexible backboards that absorb kinetic energy ($e \approx 0.5 - 0.7$). In Rapier, colliders are assigned restitution coefficients: rim ($0.65$), backboard ($0.70$), and ball ($0.82$). Shots that strike the back iron bounce realistically according to contact normal impulse resolution.

---

## 9. Manual Validation Status & Browser Verification Checklist

To run the simulator locally in any modern desktop browser:
```powershell
npm run dev
```
Navigate to `http://localhost:5173`.

### Interactive Verification Steps
1. **Initial Scene & Telemetry Panel Verification**:
   - Confirm that the `AUTONOMOUS SHOOTER` and `SHOT PERFORMANCE` cards are visible in the right-hand sidebar.
   - Confirm that the trajectory grid displays live target distance, launch angle, required flywheel RPM, and adaptive bias offsets.
2. **Autonomous End-to-End Test (`Acquire & Shoot`)**:
   - Click **Acquire & Shoot** on the toolbar or sidebar card.
   - Observe the robot transition to `NAVIGATING_TO_BALL`, traverse the court using A* path planning, approach the ball, and activate front intake rollers.
   - Verify optical sensor detects ball, ball physically nests into the front cradle, and possession transitions to `BALL_CAPTURED`.
   - Observe robot drive to the free-throw key (`NAVIGATING_TO_KEY`), rotate to align with the East hoop (`ALIGNING_WITH_HOOP`), ramp up dual flywheels (`SPINNING_UP`), and launch the basketball (`FIRING`).
   - Track ball flight through the air, observe downward rim penetration, net animation, and score increment.
3. **Adaptive Shot Correction Validation**:
   - If a shot misses short or long due to distance variations, observe the `ADAPTIVE BIAS` bar immediately update ($\Delta v$, $\Delta\theta$, or $\Delta\psi$).
   - On subsequent shots, verify that the launcher applies the calibrated bias to correct the trajectory.
   - Verify that the last 5 shots are logged in the `RECENT SHOTS (LAST 5)` list with colored badges.
4. **Safety & Cancellation Verification**:
   - Click **Abort** or press <kbd>Space</kbd> during alignment or spin-up.
   - Verify that all motion immediately ceases, flywheels stop, and sequence enters `CANCELLED` state.
