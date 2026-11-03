# SMART-BASKETBOT — Phase 1: Physics and Shooting Corrections Report

**Project:** SMART-BASKETBOT Simulator  
**Location:** `C:\Projects\smart-basketbot-simulator`  
**Milestone:** Phase 1 — Physics and Shooting Corrections  
**Date:** November 2026  
**Status:** Complete & Fully Verified (221/221 tests passing; 0 build errors)

---

## 1. Executive Summary

Phase 1 addressed three fundamental physics and ballistic discrepancies identified during system auditing:

1. **Basketball Hoop Collision Geometry:** Replaced 12 unrotated axis-aligned box colliders with 16 tangentially rotated box colliders attached as a compound collider to a single static rigid body, expanding the effective rim clearance aperture from $0.326\text{ m}$ to the regulation diameter of $0.426\text{ m}$ (matching the $0.45\text{ m}$ visual rim).
2. **Basketball Muzzle Spawn Position & Velocity Addition:** Relocated the muzzle spawn exit from $(+0.20, +0.45, 0.0)$ (which was inside the dynamic chassis box collider) to $(+0.54, +0.45, 0.0)$, guaranteeing a $> 4.0\text{ cm}$ clearance margin in front of the front bumper ($X = 0.38\text{ m}$) and avoiding the intake roller ($Y < 0.20\text{ m}$). Fired balls now inherit the robot's linear velocity vector via Galilean relativity ($\mathbf{v}_{\text{ball}} = \mathbf{v}_{\text{launch}} + \mathbf{v}_{\text{robot}}$).
3. **Damped Ballistic Trajectory Calculations:** Replaced vacuum parabolic trajectory formulas with an analytical and Newton-Raphson numerical solver incorporating Rapier3D linear damping ($\gamma = 0.08\text{ s}^{-1}$) and gravity ($g = 9.81\text{ m/s}^2$), eliminating the $35\text{–}41\text{ cm}$ undershoot at medium-to-long ranges and achieving $< 1.8\text{ cm}$ landing accuracy under Rapier simulation.

---

## 2. TASK 1 — Hoop Collision Geometry

### 2.1 Problem Analysis
In `src/environment/BasketballHoop.js`, the regulation circular rim ($R = 0.225\text{ m}$, tube $r_{\text{tube}} = 0.012\text{ m}$) was previously approximated by 12 independent static cuboid bodies created via `PhysicsWorld.createStaticBox()`. Because `createStaticBox` only applied global translations without rotations:
- Every segment remained strictly axis-aligned ($X$-width $0.0264\text{ m}$, $Z$-length $0.1237\text{ m}$).
- At $\theta = \pm 90^\circ$ (lateral rim points), the $0.1237\text{ m}$ length projected radially inward into the hoop aperture by $0.06185\text{ m}$ on each side.
- This constricted the central clear diameter from $0.426\text{ m}$ down to $0.3263\text{ m}$ (a $27.5\%$ constriction), causing incoming basketballs ($0.24\text{ m}$ diameter) to suffer spurious collisions with invisible inward edges.

### 2.2 Mathematical Model & Implementation
1. **Compound Collider Structure:** Created a single static rigid body placed at the rim center $(rimX, rimY, rimZ)$.
2. **Segment Count & Dimensions:**
   - Segments: $N = 16$, step angle $\Delta\theta = \frac{2\pi}{16} = 22.5^\circ$.
   - Radial half-thickness: $h_x = r_{\text{tube}} = 0.012\text{ m}$.
   - Vertical half-height: $h_y = r_{\text{tube}} = 0.012\text{ m}$.
   - Tangential half-length: $h_z = R \sin(\Delta\theta / 2) \times 1.05 \approx 0.0460\text{ m}$.
3. **Local Segment Placement & Tangential Orientation:**
   For segment $i \in \{0, \dots, N-1\}$ with $\theta_i = i \Delta\theta$:
   $$\mathbf{t}_i = (R \cos\theta_i, 0, R \sin\theta_i)$$
   Yaw rotation by angle $\psi_i = -\theta_i$ represented by Rapier unit quaternion:
   $$q_i = \left(0, \sin(-\theta_i / 2), 0, \cos(-\theta_i / 2)\right) = \left(0, -\sin(\theta_i / 2), 0, \cos(\theta_i / 2)\right)$$
4. **Geometric Proof of Non-Intrusion:**
   In the hoop plane, any point $(x_{\text{loc}}, z_{\text{loc}})$ within segment $i$ transforms to world offset:
   $$\begin{pmatrix} x \\ z \end{pmatrix} = \begin{pmatrix} (R + x_{\text{loc}}) \cos\theta_i - z_{\text{loc}} \sin\theta_i \\ (R + x_{\text{loc}}) \sin\theta_i + z_{\text{loc}} \cos\theta_i \end{pmatrix}$$
   The squared distance to the hoop center is:
   $$r^2 = (R + x_{\text{loc}})^2 + z_{\text{loc}}^2$$
   Since $x_{\text{loc}} \in [-h_x, +h_x]$ with $h_x = 0.012\text{ m}$ and $z_{\text{loc}}^2 \ge 0$:
   $$r \ge R - h_x = 0.225 - 0.012 = 0.213\text{ m} \quad \forall (x_{\text{loc}}, z_{\text{loc}})$$
   Thus, the clear inner opening is guaranteed to be $\ge 2 \times 0.213\text{ m} = 0.426\text{ m}$ across all azimuths.

---

## 3. TASK 2 — Basketball Muzzle Spawn Position & Velocity Addition

### 3.1 Problem Analysis
In `src/robot/ShootingMechanism.js`, the muzzle exit position was hardcoded at $(+0.20, +0.45, 0.0)$ relative to the robot chassis origin.
The robot dynamic chassis collider bounding box:
- $X \in [-0.38, +0.38]\text{ m}$ (length $0.76\text{ m}$)
- $Y \in [0.04, 0.79]\text{ m}$ (centered at $Y = 0.415\text{ m}$, half-height $0.375\text{ m}$)
- $Z \in [-0.31, +0.31]\text{ m}$ (width $0.62\text{ m}$)

A basketball with radius $R_{\text{ball}} = 0.12\text{ m}$ spawned at $X = 0.20\text{ m}$ occupied $X \in [0.08, 0.32]\text{ m}$, entirely within the solid chassis collider. This resulted in collision impulses, launch trajectory deflection, and penetration explosions. Furthermore, the ball did not inherit the robot's translational velocity upon launch.

### 3.2 Implementation
1. **Verified Muzzle Coordinates:**
   Updated `muzzleLocalPos` in `ShootingMechanism.js`, `SimulationConfig.js`, `ClosedLoopShootingController.js`, `AutonomousShooterWorkflow.js`, and `AutonomousGameplayController.js` to:
   $$\mathbf{r}_{\text{muzzle, local}} = (0.54, 0.45, 0.0)$$
   - Longitudinal clearance: Front bumper is at $X = +0.38\text{ m}$. Rear face of spawned ball is at $X_{\text{rear}} = 0.54 - 0.12 = 0.42\text{ m}$. Clearance margin $= 0.42 - 0.38 = 0.04\text{ m} = 4.0\text{ cm} \ge 3.0\text{ cm}$.
   - Vertical clearance: Intake roller is at $X = 0.49\text{ m}, Y = 0.16\text{ m}$. Bottom of spawned ball is at $Y = 0.45 - 0.12 = 0.33\text{ m}$ ($> 17\text{ cm}$ above intake roller).
2. **Galilean Velocity Inheritance:**
   When the shot is triggered in `ShootingMechanism.fire()`:
   $$\mathbf{v}_{\text{ball}} = \mathbf{v}_{\text{launch}} + \mathbf{v}_{\text{robot}}$$
   $$\mathbf{v}_{\text{ball}} = \begin{pmatrix} v_{\text{launch}, x} + v_{\text{robot}, x} \\ v_{\text{launch}, y} + v_{\text{robot}, y} \\ v_{\text{launch}, z} + v_{\text{robot}, z} \end{pmatrix}$$
3. **Interlocks:**
   Possession verification (`robot.intake.isBallCaptured`) and release (`robot.intake.releaseBall()`) remain strictly enforced.

---

## 4. TASK 3 — Trajectory Calculations for Rapier Physics

### 4.1 Aerodynamic Drag Model under Rapier 3D
In Rapier3D, linear damping is applied per step to dynamic bodies:
$$\frac{d\mathbf{v}}{dt} = \mathbf{g} - \gamma \mathbf{v}$$
where $\gamma = 0.08\text{ s}^{-1}$ (from `SimulationConfig.js` and `PhysicsWorld.js`) and $\mathbf{g} = (0, -g, 0)$ with $g = 9.81\text{ m/s}^2$.

### 4.2 Analytical Kinematic Equations
Integrating horizontally along the line-of-sight distance $r(t)$ with $r(0) = 0, v_r(0) = v_{r0}$:
$$v_r(t) = v_{r0} e^{-\gamma t} \implies r(t) = \frac{v_{r0}}{\gamma} (1 - e^{-\gamma t})$$
Setting $r(t) = d$:
$$v_{r0} = \frac{\gamma d}{1 - e^{-\gamma t}}$$

Integrating vertically with $y(0) = y_0, v_y(0) = v_{y0}$:
$$v_y(t) = \left(v_{y0} + \frac{g}{\gamma}\right) e^{-\gamma t} - \frac{g}{\gamma}$$
$$y(t) - y_0 = \frac{v_{y0}}{\gamma} (1 - e^{-\gamma t}) - \frac{g}{\gamma^2} (\gamma t - 1 + e^{-\gamma t})$$

Since $v_{y0} = v_{r0} \tan\theta$, the first term simplifies to:
$$\frac{v_{y0}}{\gamma} (1 - e^{-\gamma t}) = \tan\theta \cdot \left[\frac{v_{r0}}{\gamma} (1 - e^{-\gamma t})\right] = d \tan\theta$$

Substituting $y(t) - y_0 = dy$ (where $dy = y_{\text{target}} - y_{\text{launch}}$):
$$dy = d \tan\theta - \frac{g}{\gamma^2} (\gamma t - 1 + e^{-\gamma t})$$

Rearranging into standard root-finding form:
$$f(\tau) = \tau - 1 + e^{-\tau} - \frac{\gamma^2 (d \tan\theta - dy)}{g} = 0, \quad \text{where } \tau = \gamma t$$

### 4.3 Newton-Raphson Solver
For any $K = d \tan\theta - dy > 0$, the function $g(\tau) = \tau - 1 + e^{-\tau}$ is strictly convex with $g'(\tau) = 1 - e^{-\tau} > 0$ for all $\tau > 0$.
Starting from the vacuum initial estimate $\tau_0 = \gamma \sqrt{\frac{2K}{g}}$:
$$\tau_{k+1} = \tau_k - \frac{\tau_k - 1 + e^{-\tau_k} - \frac{\gamma^2 K}{g}}{1 - e^{-\tau_k}}$$
The solver converges quadratically to machine precision ($|\Delta\tau| < 10^{-12}$) in $3\text{–}4$ iterations. Flight time is $t = \tau / \gamma$.

### 4.4 Peak Apex Height and Arrival Kinematics
- Apex time (when $v_y(t) = 0$):
  $$t_{\text{apex}} = \frac{1}{\gamma} \ln\left(1 + \frac{\gamma v_{y0}}{g}\right)$$
  $$y_{\text{apex}} = y_{\text{launch}} + \frac{v_{y0}}{\gamma} - \frac{g}{\gamma^2} \ln\left(1 + \frac{\gamma v_{y0}}{g}\right)$$
- Arrival velocity at $t = t_{\text{flight}}$:
  $$v_{r, \text{arrival}} = v_{r0} e^{-\gamma t_{\text{flight}}}$$
  $$v_{y, \text{arrival}} = \left(v_{y0} + \frac{g}{\gamma}\right) e^{-\gamma t_{\text{flight}}} - \frac{g}{\gamma}$$
  $$\theta_{\text{entry}} = \arctan2(-v_{y, \text{arrival}}, v_{r, \text{arrival}})$$

### 4.5 Empirical Comparison in Rapier 3D Simulation
| Shot Distance | Vacuum Undershoot | Damped Solver Arrival Error | Error Reduction |
|---|---|---|---|
| **$4.225\text{ m}$ (Free Throw)** | $-16.1\text{ cm}$ ($\Delta X = -10.1\text{ cm}, \Delta Y = -12.5\text{ cm}$) | **$1.4\text{ cm}$** | **$91.3\%$ reduction** |
| **$7.000\text{ m}$ (3-Point Range)** | $-41.5\text{ cm}$ ($\Delta X = -31.4\text{ cm}, \Delta Y = -27.3\text{ cm}$) | **$1.8\text{ cm}$** | **$95.7\%$ reduction** |

*(Note: the residual $< 1.8\text{ cm}$ discrepancy is solely due to the discrete $1/60\text{ s}$ physics timestep truncation, which is well within the $9.3\text{ cm}$ clearance margin).*

---

## 5. Verification and Test Results

### 5.1 Automated Test Suites
A dedicated test suite `tests/physicsCorrections.test.js` was created covering all regression criteria:

| Test Group | Test Description | Result |
|---|---|---|
| **Hoop Geometry** | Compound rim collider on single static rigid body | **PASS** |
| **Hoop Geometry** | Clear circular opening diameter $\ge 0.426\text{ m}$ | **PASS** |
| **Hoop Geometry** | Center drop through rim with 0 physical contacts | **PASS** |
| **Hoop Geometry** | Off-center drop ($0.06\text{ m}$) with 0 physical contacts | **PASS** |
| **Hoop Geometry** | Direct rim impact registers physical contact and bounce | **PASS** |
| **Muzzle Position** | `muzzleLocalPos` outside chassis AABB with $\ge 3\text{ cm}$ margin | **PASS** |
| **Muzzle Position** | 0 contact interpenetration on launch frame | **PASS** |
| **Velocity Addition** | Galilean linear velocity inheritance ($\mathbf{v}_{\text{ball}} = \mathbf{v}_{\text{launch}} + \mathbf{v}_{\text{robot}}$) | **PASS** |
| **Interlocks** | Rejection without possession; clean release on fire | **PASS** |
| **Damped Ballistics** | Simulated Rapier landing accuracy within $< 2\text{ cm}$ at hoop | **PASS** |
| **Damped Ballistics** | Elimination of $35\text{–}41\text{ cm}$ undershoot at $7\text{ m}$ | **PASS** |
| **Damped Ballistics** | Closed-form `predictPositionAtTime` exact target arrival | **PASS** |
| **Damped Ballistics** | Trajectory point generation along complete flight arc | **PASS** |

### 5.2 Full Test Suite Summary
```
 Test Files  13 passed (13)
      Tests  221 passed (221)
   Duration  1.71s
```

### 5.3 Production Build
```
✓ built in 472ms
dist/index.html                     0.77 kB │ gzip:     0.43 kB
dist/assets/index-NQN989MX.css     15.33 kB │ gzip:     3.68 kB
dist/assets/index-DQMJJPty.js   5,377.23 kB │ gzip: 1,943.92 kB
```
Production bundle compiles cleanly with zero errors.
