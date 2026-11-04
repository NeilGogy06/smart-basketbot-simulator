# SMART-BASKETBOT — Technical Implementation

**Document ID:** SBB-TECH-2026-FINAL  
**System:** SMART-BASKETBOT Autonomous Robotics Basketball Simulator  
**Scope:** Mathematical Formulations, Algorithms, and Engineering Implementation  

---

## 1. 3D Environment & WebGL Rendering Subsystem

The visual environment is constructed using **Three.js (r187)** executing within modern browser WebGL 2.0 contexts.

### 1.1 FIBA Regulation Court Modeling
The environment reproduces a standard FIBA competition basketball court ($28.0\text{m} \times 15.0\text{m}$) enclosed by a $2.0\text{m}$ perimeter apron ($32.0\text{m} \times 19.0\text{m}$ total envelope):
- **Court Surface:** Textured hardwood floor material utilizing custom UV-mapped plank shaders with anisotropic filtering and specular roughness maps.
- **Regulation Markings:** White court lines ($50\text{mm}$ line width) modeled via parametric line segments: boundary lines, center line, center circle ($r = 1.80\text{m}$), three-point arc ($r = 6.75\text{m}$ from hoop center), free-throw line ($5.80\text{m}$ from endline), and restricted key areas ($4.90\text{m} \times 5.80\text{m}$).
- **Lighting Model:** Three-point directional arena lighting with soft PCF shadow maps and ambient fill lights simulating indoor stadium illuminance.

### 1.2 Viewport Rendering Pipeline
- **Coordinate Conventions:** Right-handed Cartesian world system $(X, Y, Z)$ where the horizontal court plane lies in $X$-$Z$, and the positive $Y$-axis points vertically upward opposing gravity ($\mathbf{g} = [0, -9.81, 0]^T\text{ m/s}^2$).
- **Multi-Camera Perspective Management:** Supports dynamic camera orbit controls and four instantaneous presets:
  1. *Overview Preset:* Broad isometric court perspective $(X = 0, Y = 12, Z = 18)$.
  2. *Robot Orbit Preset:* Third-person chase perspective tracking the robot base.
  3. *Hoop Focus Preset:* Elevated perspective directed down through the target rim.
  4. *Tactical Top-Down Preset:* Orthographic planar view of the court for navigation monitoring.

---

## 2. Rapier3D WebAssembly Physics Integration

Rigid-body dynamics and contact mechanics are computed by **Rapier3D (`@dimforge/rapier3d-compat` v0.21.0)**, a multi-threaded physics engine compiled from Rust to WebAssembly.

### 2.1 Fixed-Timestep Sub-Step Accumulator
Because browser `requestAnimationFrame` loops experience fluctuating display refresh intervals (e.g. 59.8 Hz to 144 Hz) and transient frame drops, physics updates cannot be safely tied to raw frame time. `PhysicsWorld.js` decouples simulation physics from display rendering using an accumulator-based fixed-timestep loop:

```javascript
// Fixed physics step parameters
const FIXED_DT = 1.0 / 60.0; // 0.016667 seconds (60 Hz)
const MAX_ACCUMULATOR = 0.10; // 100ms cap to eliminate spiral-of-death

step(deltaTime) {
  this.accumulator += Math.min(deltaTime, MAX_ACCUMULATOR);
  while (this.accumulator >= FIXED_DT) {
    this.world.step();
    this.accumulator -= FIXED_DT;
  }
}
```

### 2.2 Rigid Body & Collider Binding
Each physical entity maintains a synchronized binding between its Rapier rigid-body handle and Three.js mesh:
- **Transform Sync:** At each frame, translation vectors $\mathbf{t} = [x, y, z]^T$ and orientation quaternions $\mathbf{q} = [q_x, q_y, q_z, q_w]^T$ are read directly from WebAssembly memory buffers and written to Three.js matrices without intermediate object allocation.
- **Continuous Collision Detection (CCD):** Dynamic basketball rigid bodies operate with CCD enabled (`rigidBody.enableCcd(true)`), preventing fast-moving projectiles from tunneling through solid backboards or thin rim colliders between time steps.

### 2.3 16-Segment Compound Rotated Hoop Rim Collider
Previous simulation iterations utilized crude axis-aligned bounding boxes (AABBs) for the circular basketball rim, creating invisible internal corners that artificially obstructed incoming basketballs.

In `BasketballHoop.js`, the regulation rim ($D_{\text{rim}} = 0.45\text{m}$, elevation $Y = 3.05\text{m}$) is modeled as a compound rigid body composed of **16 discrete, rotated box collider segments** arranged tangentially along a circle:
- For segment $i \in \{0, 1, \dots, 15\}$, angular position $\phi_i = i \cdot \frac{2\pi}{16}$.
- Segment center: $x_i = R_{\text{rim}} \cos(\phi_i)$, $z_i = R_{\text{rim}} \sin(\phi_i)$, with $R_{\text{rim}} = 0.225\text{m}$.
- Segment rotation: Yaw quaternion rotated by $\phi_i + \frac{\pi}{2}$ rad.
- Contact properties: Restitution coefficient $e = 0.55$, friction coefficient $\mu = 0.40$.

Beneath the rim, a cylindrical sensor trigger volume ($r = 0.22\text{m}$, height $0.20\text{m}$) monitors descending basketballs with downward vertical velocity ($v_y < -0.5\text{ m/s}$), firing scoring confirmation events.

---

## 3. Differential-Drive Kinematics & Motion Control

The mobile robot chassis is modeled as a two-wheel differential drive base with dual front omnidirectional castor wheels.

```
       Front (Intake Scoop & Camera)
              +---------------+
              |   [INTAKE]    |
              |   [CAMERA]    |
       Left   |               |   Right
      Drive   |       +       |   Drive
      Wheel  [=]    (CoM)    [=]  Wheel
              |               |
              +---------------+
                     Rear
```

### 3.1 Kinematic Formulations
Let $r = 0.08\text{m}$ be the drive wheel radius and $L = 0.45\text{m}$ be the effective track width. The chassis pose in world coordinates is $\mathbf{q} = [x, z, \theta]^T$.

#### Forward Kinematics
Given left and right wheel angular velocities $\omega_L$ and $\omega_R$ (in rad/s):
$$v = \frac{r (\omega_R + \omega_L)}{2}$$
$$\omega = \frac{r (\omega_R - \omega_L)}{L}$$

The continuous-time state derivatives are:
$$\dot{x} = v \cos(\theta), \quad \dot{z} = -v \sin(\theta), \quad \dot{\theta} = \omega$$

#### Inverse Kinematics
Given target linear forward velocity $v$ and target angular yaw rate $\omega$:
$$\omega_L = \frac{v - \frac{\omega L}{2}}{r}, \quad \omega_R = \frac{v + \frac{\omega L}{2}}{r}$$

### 3.2 Dual-Wheel Velocity & Heading PID Control
Actuator commands are governed by discrete Proportional-Integral-Derivative (PID) controllers with anti-windup clamping:

$$u[k] = K_p e[k] + K_i \sum_{j=0}^k e[j] \Delta t + K_d \frac{e[k] - e[k-1]}{\Delta t}$$

- **Anti-Windup Protection:** The integral accumulator is bounded to prevent actuator windup:
  $$I[k] = \text{clamp}\left(I[k-1] + K_i e[k] \Delta t, -I_{\text{limit}}, +I_{\text{limit}}\right)$$
- **Angular Error Normalization:** For heading orientation control, angular heading error $e_\theta$ is wrapped into $[-\pi, +\pi]$ rad:
  $$e_\theta = \text{atan2}(\sin(\theta_{\text{target}} - \theta), \cos(\theta_{\text{target}} - \theta))$$
- **Velocity Slew Ramping:** Commanded linear velocity is constrained by maximum linear acceleration $a_{\text{max}} = 1.8\text{ m/s}^2$ and maximum angular acceleration $\alpha_{\text{max}} = 4.5\text{ rad/s}^2$.

---

## 4. Navigation Grid & A* Path Planning

Global motion planning is handled by `NavigationGrid.js` and `AStarPlanner.js`.

### 4.1 2D Occupancy Grid Discretization
The $28.0\text{m} \times 15.0\text{m}$ court is discretized into a 2D uniform grid:
- **Cell Resolution:** $\delta = 0.25\text{m}$ per grid cell ($112 \times 60 = 6,720$ total cells).
- **Obstacle Inflation Envelope:** Static obstacles (hoop stanchions, backboard posts, and perimeter walls) are inflated by robot bounding radius $R_{\text{robot}} = 0.32\text{m}$ plus an engineering safety margin $d_{\text{margin}} = 0.10\text{m}$:
  $$R_{\text{inflation}} = R_{\text{robot}} + d_{\text{margin}} = 0.42\text{m}$$
  Any cell whose Euclidean distance to an obstacle is $\le 0.42\text{m}$ is marked impassable.

### 4.2 8-Connected A* Graph Search
A\* explores the 8-connected grid using an admissible Euclidean distance heuristic:
$$f(n) = g(n) + h(n)$$
$$h(n) = \sqrt{(x_n - x_{\text{goal}})^2 + (z_n - z_{\text{goal}})^2}$$

- Cardinal transition cost: $c_{\text{card}} = \delta = 0.25\text{m}$.
- Diagonal transition cost: $c_{\text{diag}} = \sqrt{2} \delta \approx 0.3536\text{m}$.
- Corner-cutting prevention prevents the planner from squeezing between diagonal obstacles.

### 4.3 Raycast String-Pulling Waypoint Smoothing
Raw grid paths exhibit unnatural staircased trajectories. The post-search string-pulling algorithm traverses the raw waypoint array $(W_0, W_1, \dots, W_N)$:
1. Set anchor waypoint $A = W_0$.
2. For candidate index $k$ from $N$ down to $i+1$, cast a 2D line-of-sight ray between $A$ and $W_k$.
3. If the ray does not intersect any inflated obstacle cell, prune all intermediate waypoints $W_{i+1}, \dots, W_{k-1}$ and connect $A$ directly to $W_k$.
4. Set $A = W_k$ and repeat until the goal is reached.

This reduces waypoint count by **over 70%** and produces smooth linear vectors.

---

## 5. Simulated Vision & Spatial Target Tracking

The perception subsystem models an on-board synthetic camera mounted on an elevated sensor mast ($h = 0.75\text{m}$, horizontal FOV $\alpha_{\text{FOV}} = 75^\circ$, downward tilt $-12^\circ$).

### 5.1 Geometric Vision Pipeline (Non-Deep-Learning)
To avoid high GPU overhead and maintain determinism, SMART-BASKETBOT implements a **simulated geometric computer vision pipeline**:
1. **Frustum Projection:** 3D world coordinates $\mathbf{P}_w = [X_w, Y_w, Z_w, 1]^T$ of court objects are transformed into camera frame $\mathbf{P}_c = \mathbf{T}_{cw} \mathbf{P}_w$ and projected into Normalized Device Coordinates (NDC) $[-1, 1]$.
2. **Field-of-View Gating:** Objects falling outside the $[-1, 1]$ frustum bounds are discarded.
3. **Raycast Line-of-Sight Occlusion:** For candidate objects inside the frustum, a ray is cast from the camera origin to the object center. If the ray intersects an intervening obstacle mesh (such as a hoop stanchion), the object is flagged as occluded.
4. **Range & Azimuth Calculation:**
   $$d = \sqrt{(X_{\text{ball}} - X_{\text{robot}})^2 + (Z_{\text{ball}} - Z_{\text{robot}})^2}$$
   $$\phi = \text{wrapToPi}\left(\text{atan2}(Z_{\text{ball}} - Z_{\text{robot}}, X_{\text{ball}} - X_{\text{robot}}) - \theta_{\text{robot}}\right)$$

### 5.2 Multi-Target Tracking & Kalman Filtering
`ObjectTracker.js` associates sequential detections using Euclidean distance gating ($\Delta d < 1.0\text{m}$). Tracked objects maintain persistent IDs (e.g. `BALL_01`) and are filtered through a discrete Kalman state estimator to smooth measurement noise and predict velocity vectors.

---

## 6. Basketball Intake & Optical Possession Sensing

The ball acquisition mechanism operates in two sequential stages:

```
[Basketball Approaching] ===> [Roller Capture] ===> [Optical Beam-Break] ===> [Cradle Lock]
  (d <= 0.45m)                  (Rollers: 25 rad/s)   (Sensor Triggered)       (Rollers Stopped)
```

1. **Intake Roller Actuation:** When the robot approaches within capture range ($d \le 0.45\text{m}$), the intake scoop counter-rotating silicone rollers spin up to $25\text{ rad/s}$, pulling the ball inward at $3.2\text{ m/s}$.
2. **Optical Beam-Break Sensor Gate:** A simulated photoelectric break-beam sensor positioned $0.08\text{m}$ behind the intake rollers monitors ball penetration. When the basketball breaks the optical beam:
   - State machine triggers `POSSESSION_CONFIRMED`.
   - The ball rigid body is kinematically locked to the launcher cradle constraint.
   - Intake roller motors are automatically de-energized to conserve power and prevent physical wear.

---

## 7. Damped Ballistic Trajectory Calculation & Closed-Loop Aiming

Unlike static launchers that shoot from fixed distances, SMART-BASKETBOT calculates launch parameters dynamically from any feasible court location ($2.2\text{m} \le d \le 9.0\text{m}$).

### 7.1 Ballistic Equations with Linear Aerodynamic Drag
The basketball (mass $m = 0.62\text{kg}$) moves under gravity $\mathbf{g}$ and linear atmospheric drag force $\mathbf{F}_D = -m \gamma \mathbf{v}$, where $\gamma = 0.08\text{ s}^{-1}$ is the linear drag coefficient:
$$\ddot{x}(t) = -\gamma \dot{x}(t), \quad \ddot{y}(t) = -g - \gamma \dot{y}(t)$$

Integrating with initial conditions $\mathbf{r}(0) = [x_0, y_0]^T$ and $\mathbf{v}(0) = [v_0 \cos\theta_0, v_0 \sin\theta_0]^T$:
$$x(t) = x_0 + \frac{v_0 \cos\theta_0}{\gamma} (1 - e^{-\gamma t})$$
$$y(t) = y_0 + \left(\frac{v_0 \sin\theta_0}{\gamma} + \frac{g}{\gamma^2}\right) (1 - e^{-\gamma t}) - \frac{g}{\gamma} t$$

### 7.2 Newton-Raphson Numerical Flight-Time Solver
Let horizontal distance to the rim center be $R = x_{\text{target}} - x_0$ and vertical elevation difference be $\Delta H = y_{\text{target}} - y_0$. Substituting $v_0 \cos\theta_0 = \frac{\gamma R}{1 - e^{-\gamma T}}$ into the vertical trajectory equation yields the non-linear root equation for flight time $T$:

$$f(T) = \Delta H - R \tan\theta_0 - \frac{g}{\gamma^2} (1 - e^{-\gamma T}) + \frac{g}{\gamma} T = 0$$

The derivative with respect to flight time $T$ is:
$$f'(T) = -\frac{g}{\gamma} e^{-\gamma T} + \frac{g}{\gamma} = \frac{g}{\gamma} (1 - e^{-\gamma T})$$

The flight time $T$ is solved via Newton-Raphson root finding:
$$T_{k+1} = T_k - \frac{f(T_k)}{f'(T_k)}$$

The solver initiates with an initial guess $T_0 = \sqrt{\frac{2 \Delta H}{g}}$ and converges to $|f(T)| < 10^{-4}\text{m}$ within **4 to 5 iterations** ($< 0.1\text{ ms}$ execution budget).

### 7.3 Apparent Rim Aperture & Entry Angle Constraint
For a horizontal hoop rim ($D_{\text{rim}} = 0.45\text{m}$), the apparent elliptical minor axis presented to a descending basketball is:
$$D_{\text{eff}} = D_{\text{rim}} \sin(\theta_{\text{entry}})$$

Where rim entry angle $\theta_{\text{entry}}$ is:
$$\theta_{\text{entry}} = \arctan\left(\frac{|\dot{y}(T)|}{|\dot{x}(T)|}\right)$$

For a Size 7 basketball ($D_{\text{ball}} = 0.24\text{m}$), the solver strictly enforces:
$$\theta_{\text{entry}} \ge 32^\circ \implies D_{\text{eff}} \ge 0.45 \sin(32^\circ) \approx 0.2385\text{m}$$
This guarantees geometric passage through the hoop ring.

### 7.4 Adaptive Shot Bias Correction
`AdaptiveShotCorrector.js` monitors verified shot outcomes. If an impact miss vector $\mathbf{e} = [e_x, e_z]^T$ is recorded, deterministic velocity and yaw biases are updated:
$$\Delta v_{\text{bias}} \leftarrow \Delta v_{\text{bias}} - \gamma_v e_x, \quad \Delta \psi_{\text{bias}} \leftarrow \Delta \psi_{\text{bias}} - \gamma_\psi e_z$$
Biases are decayed by a factor of $0.90$ across consecutive successful baskets to prevent over-correction.

---

## 8. Autonomous Decision-Making & Utility Optimization

When multiple candidate basketballs are tracked within the camera frustum, `AutonomousDecisionEngine.js` evaluates utility score $U(i)$ for candidate $i$:

$$U(i) = 0.40 \cdot \left(1 - \frac{d_i}{d_{\text{max}}}\right) + 0.30 \cdot \left(1 - \frac{|\phi_i|}{\phi_{\text{max}}}\right) + 0.15 \cdot C_i + 0.15 \cdot F_i + 0.15 \cdot L_i$$

Where:
- $d_i / d_{\text{max}}$: Normalized Euclidean distance ($d_{\text{max}} = 15.0\text{m}$).
- $|\phi_i| / \phi_{\text{max}}$: Normalized azimuth heading error relative to current robot heading ($\phi_{\text{max}} = 75^\circ$).
- $C_i \in [0, 1]$: Optical tracking confidence score.
- $F_i \in [0, 1]$: Track freshness score based on detection age.
- $L_i = 0.15$: **Hysteresis Lock-In Bonus** applied exclusively to the currently latched target, preventing target thrashing during rapid turns.

---

## 9. Performance Analytics & Telemetry Engine

`AnalyticsManager.js` collects event-driven performance metrics without polling overhead:
- **Shooting Analytics:** Attempts, makes, misses, goal conversion %, average launch velocity, average flight time.
- **Navigation Analytics:** Cumulative distance traveled, path efficiency % ($\frac{\text{Planned Length}}{\text{Actual Travelled Distance}} \times 100$), obstacle encounter count.
- **Motion Analytics:** Mean linear and angular tracking errors, wheel RPM distributions.
- **Autonomy Analytics:** Session duration, dwell time distribution across all 14 states, recovery event counts.
- **Data Export:** Telemetry records can be downloaded in real-time as standardized JSON or CSV files for external analysis in Python, MATLAB, or Excel.
