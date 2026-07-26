const TAU = Math.PI * 2;
const DAYS_PER_YEAR = 365.25;
const JUPITER_MASS_IN_SOLAR = 1 / 1047.3486;
const SOLAR_RADIUS_AU = 0.00465047;
const JUPITER_RADIUS_AU = 0.000477895;
const ORBIT_ROTATION = 24 * Math.PI / 180;

const PRESETS = {
  coronagraph: {
    starMass: 1,
    planetMass: 1,
    semiMajor: 5.2,
    eccentricity: 0.05,
    inclination: 62,
    maskMas: 90,
    distancePc: 10,
    timeDays: 310,
    speed: 42,
  },
  transit: {
    starMass: 0.9,
    planetMass: 0.75,
    semiMajor: 0.055,
    eccentricity: 0,
    inclination: 89,
    maskMas: 1,
    distancePc: 18,
    timeDays: 0,
    speed: 0.35,
  },
  reflex: {
    starMass: 0.72,
    planetMass: 4.2,
    semiMajor: 1.4,
    eccentricity: 0.34,
    inclination: 74,
    maskMas: 32,
    distancePc: 14,
    timeDays: 95,
    speed: 12,
  },
};

const LIMITS = {
  starMass: [0.2, 2.2],
  planetMass: [0.05, 10],
  semiMajor: [0.03, 8],
  eccentricity: [0, 0.7],
  inclination: [0, 90],
  maskMas: [0, 250],
  distancePc: [2, 50],
  timeDays: [0, 20000],
  speed: [0, 80],
};

function bounded(value, [min, max], fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function solveEccentricAnomaly(meanAnomaly, eccentricity) {
  let eccentricAnomaly = meanAnomaly;
  for (let iteration = 0; iteration < 7; iteration += 1) {
    eccentricAnomaly -= (
      eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly
    ) / (1 - eccentricity * Math.cos(eccentricAnomaly));
  }
  return eccentricAnomaly;
}

function circularArc(phases) {
  if (phases.length < 2) return 0;
  const sorted = phases
    .map((phase) => ((phase % TAU) + TAU) % TAU)
    .sort((a, b) => a - b);
  let largestGap = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const next = index === sorted.length - 1 ? sorted[0] + TAU : sorted[index + 1];
    largestGap = Math.max(largestGap, next - sorted[index]);
  }
  return TAU - largestGap;
}

function format(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

function rotatePoint(x, y, angle = ORBIT_ROTATION) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: x * cosine - y * sine,
    y: x * sine + y * cosine,
  };
}

export const setup = {
  id: "gravity",
  host: "gravitysetup.com",
  name: "GravitySetup",
  field: "Orbital dynamics",
  experiment: "Reveal an exoplanet",
  accent: "#b8a4ff",
  themeColor: "#090a12",
  code: "GRV–05",
  summary: "Hide a star, find its planet, and combine sky position, transit, and radial velocity into an orbit.",
  scope: "A deterministic Keplerian two-body model with barycentric stellar reflex and idealized coronagraph, transit, and radial-velocity readouts.",
  limits: [
    "The coronagraph is a geometric inner-working-angle mask, not a diffraction or speckle simulation.",
    "The orbit is one star plus one planet; resonances, perturbations, and full N-body dynamics are not integrated.",
    "Transit and radial-velocity signals are noiseless idealizations with simple mass–radius assumptions.",
  ],
  interaction: "Drag anywhere on the projected orbit to move time; release to record an astrometric observation.",
  canvasHint: "Drag the orbit to scrub time · release to record a sky position · ←/→ steps one day",
  presets: [
    {
      id: "coronagraph",
      label: "Cold Jupiter",
      description: "Direct imaging outside a 90 mas occulting mask.",
    },
    {
      id: "transit",
      label: "Hot transit",
      description: "Nearly edge-on orbit with a short period and visible transit.",
    },
    {
      id: "reflex",
      label: "Eccentric reflex",
      description: "A massive planet producing a strong, asymmetric RV curve.",
    },
  ],

  mount(context) {
    const {
      canvas,
      clamp,
      createAction,
      createDivider,
      createRange,
      pointerPosition,
      resizeCanvas,
      setMetrics,
      setStatus,
      setTick,
      showToast,
    } = context;

    let parameters = { ...PRESETS.coronagraph };
    let observations = [];
    let activePreset = "coronagraph";
    let running = true;
    let destroyed = false;
    let dragging = false;
    let dragMoved = false;
    let animationFrame = 0;
    let tick = 0;
    let lastFrameTime = performance.now();
    let layout = null;

    const controls = {};

    function periodDays() {
      const planetSolar = parameters.planetMass * JUPITER_MASS_IN_SOLAR;
      return DAYS_PER_YEAR * Math.sqrt(
        parameters.semiMajor ** 3 / (parameters.starMass + planetSolar),
      );
    }

    function orbitalState(atDays = parameters.timeDays) {
      const period = periodDays();
      const meanAnomaly = ((atDays / period) * TAU) % TAU;
      const eccentricAnomaly = solveEccentricAnomaly(meanAnomaly, parameters.eccentricity);
      const root = Math.sqrt(1 - parameters.eccentricity ** 2);
      const orbitX = parameters.semiMajor * (Math.cos(eccentricAnomaly) - parameters.eccentricity);
      const orbitY = parameters.semiMajor * root * Math.sin(eccentricAnomaly);
      const trueAnomaly = Math.atan2(
        root * Math.sin(eccentricAnomaly),
        Math.cos(eccentricAnomaly) - parameters.eccentricity,
      );
      const rotated = rotatePoint(orbitX, orbitY);
      const inclination = parameters.inclination * Math.PI / 180;
      const skyX = rotated.x;
      const skyY = rotated.y * Math.cos(inclination);
      const lineOfSight = rotated.y * Math.sin(inclination);
      const separationAu = Math.hypot(skyX, skyY);
      const separationMas = (separationAu / parameters.distancePc) * 1000;
      const transitionWidth = Math.max(3, parameters.maskMas * 0.18);
      const throughput = clamp(
        (separationMas - parameters.maskMas + transitionWidth) / (transitionWidth * 2),
        0,
        1,
      );

      const totalSolarMass = parameters.starMass
        + parameters.planetMass * JUPITER_MASS_IN_SOLAR;
      const amplitude = 28.4329
        * parameters.planetMass
        * Math.sin(inclination)
        * (period / DAYS_PER_YEAR) ** (-1 / 3)
        * totalSolarMass ** (-2 / 3)
        / Math.sqrt(1 - parameters.eccentricity ** 2);
      const radialVelocity = amplitude * (
        Math.cos(trueAnomaly + ORBIT_ROTATION)
        + parameters.eccentricity * Math.cos(ORBIT_ROTATION)
      );

      const starRadius = SOLAR_RADIUS_AU * parameters.starMass ** 0.8;
      const planetRadius = JUPITER_RADIUS_AU * clamp(
        0.82 + 0.18 * Math.log10(parameters.planetMass + 1),
        0.72,
        1.18,
      );
      const transiting = lineOfSight < 0 && separationAu <= starRadius + planetRadius;
      const transitDepth = Math.min(100, (planetRadius / starRadius) ** 2 * 100);
      const phase = ((meanAnomaly % TAU) + TAU) % TAU;

      return {
        period,
        phase,
        eccentricAnomaly,
        trueAnomaly,
        skyX,
        skyY,
        lineOfSight,
        separationAu,
        separationMas,
        throughput,
        amplitude,
        radialVelocity,
        transiting,
        transitDepth,
      };
    }

    function observationSummary() {
      const arc = circularArc(observations.map((observation) => observation.phase));
      const lowerBound = observations.length
        ? Math.max(...observations.map((observation) => observation.radius))
          / (1 + parameters.eccentricity)
        : 0;
      return {
        arcDegrees: arc * 180 / Math.PI,
        lowerBound,
      };
    }

    function updateMetrics(state = orbitalState()) {
      const inferred = observationSummary();
      setMetrics([
        {
          id: "separation",
          label: "Sky separation",
          value: `${format(state.separationMas, 1)} mas · ${format(state.separationAu, 3)} AU`,
          tone: state.throughput > 0.6 ? "accent" : "warn",
        },
        {
          id: "mask",
          label: "Planet throughput",
          value: `${format(state.throughput * 100, 0)}%`,
          tone: state.throughput > 0.6 ? "accent" : "warn",
        },
        {
          id: "rv",
          label: "Stellar radial velocity",
          value: `${state.radialVelocity >= 0 ? "+" : ""}${format(state.radialVelocity, 2)} m/s`,
        },
        {
          id: "transit",
          label: "Transit",
          value: state.transiting ? `IN TRANSIT · ${format(state.transitDepth, 2)}%` : "clear",
          tone: state.transiting ? "accent" : "default",
        },
        {
          id: "period",
          label: "Kepler period",
          value: state.period > 730
            ? `${format(state.period / DAYS_PER_YEAR, 2)} yr`
            : `${format(state.period, 2)} d`,
        },
        {
          id: "orbit",
          label: "Observed orbit",
          value: observations.length
            ? `${observations.length} points · ${format(inferred.arcDegrees, 0)}° arc`
            : "no observations",
        },
        {
          id: "bound",
          label: "Semi-major lower bound",
          value: observations.length ? `≥ ${format(inferred.lowerBound, 2)} AU` : "—",
        },
      ]);
    }

    function markChanged(render = true) {
      tick += 1;
      setTick(tick);
      if (render) draw();
    }

    function bindRange(key, options) {
      controls[key] = createRange({
        ...options,
        id: `gravity-${key}`,
        value: parameters[key],
        onInput(value) {
          parameters[key] = bounded(value, LIMITS[key], parameters[key]);
          if (key !== "timeDays") {
            parameters.timeDays %= periodDays();
            controls.timeDays?.set(parameters.timeDays);
          }
          markChanged();
        },
      });
    }

    bindRange("starMass", {
      label: "Star mass",
      min: LIMITS.starMass[0],
      max: LIMITS.starMass[1],
      step: 0.01,
      unit: "M☉",
      description: "Sets the Kepler period and the star's approximate radius.",
    });
    bindRange("planetMass", {
      label: "Planet mass",
      min: LIMITS.planetMass[0],
      max: LIMITS.planetMass[1],
      step: 0.05,
      unit: "Mⱼ",
      description: "Controls the star's barycentric radial-velocity reflex.",
    });
    bindRange("semiMajor", {
      label: "Semi-major axis",
      min: LIMITS.semiMajor[0],
      max: LIMITS.semiMajor[1],
      step: 0.01,
      unit: "AU",
    });
    bindRange("eccentricity", {
      label: "Eccentricity",
      min: LIMITS.eccentricity[0],
      max: LIMITS.eccentricity[1],
      step: 0.01,
      description: "Zero is circular; larger values sharpen the periastron passage.",
    });
    bindRange("inclination", {
      label: "Inclination",
      min: LIMITS.inclination[0],
      max: LIMITS.inclination[1],
      step: 0.5,
      unit: "°",
      description: "90° is edge-on and maximizes transit and RV signatures.",
    });
    bindRange("maskMas", {
      label: "Occulting radius",
      min: LIMITS.maskMas[0],
      max: LIMITS.maskMas[1],
      step: 1,
      unit: "mas",
      description: "Idealized inner working angle of the coronagraph.",
    });
    bindRange("distancePc", {
      label: "System distance",
      min: LIMITS.distancePc[0],
      max: LIMITS.distancePc[1],
      step: 0.5,
      unit: "pc",
    });
    bindRange("timeDays", {
      label: "Observation time",
      min: LIMITS.timeDays[0],
      max: LIMITS.timeDays[1],
      step: 0.25,
      unit: "d",
    });
    bindRange("speed", {
      label: "Playback rate",
      min: LIMITS.speed[0],
      max: LIMITS.speed[1],
      step: 0.25,
      unit: "d/s",
    });

    createDivider("Orbit inference");
    createAction({
      id: "gravity-record",
      label: "Record observation",
      onClick() {
        recordObservation();
        showToast?.("Sky position recorded");
      },
    });
    createAction({
      id: "gravity-clear",
      label: "Clear observations",
      quiet: true,
      onClick() {
        observations = [];
        markChanged();
      },
    });

    function syncControls() {
      for (const [key, control] of Object.entries(controls)) {
        control.set(parameters[key]);
      }
    }

    function recordObservation() {
      const state = orbitalState();
      observations.push({
        timeDays: parameters.timeDays,
        phase: state.phase,
        x: state.skyX,
        y: state.skyY,
        radius: Math.hypot(state.skyX, state.skyY),
        rv: state.radialVelocity,
      });
      if (observations.length > 14) observations.shift();
      markChanged();
    }

    function drawBackdrop(drawing, width, height) {
      const gradient = drawing.createRadialGradient(
        width * 0.47,
        height * 0.4,
        0,
        width * 0.47,
        height * 0.4,
        Math.max(width, height) * 0.7,
      );
      gradient.addColorStop(0, "rgba(76, 62, 122, 0.13)");
      gradient.addColorStop(0.55, "rgba(12, 16, 24, 0.12)");
      gradient.addColorStop(1, "rgba(3, 5, 9, 0.92)");
      drawing.fillStyle = gradient;
      drawing.fillRect(0, 0, width, height);

      drawing.fillStyle = "rgba(226, 235, 255, 0.22)";
      for (let index = 0; index < 86; index += 1) {
        const x = ((index * 71 + 19) % 997) / 997 * width;
        const y = ((index * 193 + 47) % 991) / 991 * Math.max(1, height - 112);
        const radius = index % 13 === 0 ? 1.1 : 0.55;
        drawing.beginPath();
        drawing.arc(x, y, radius, 0, TAU);
        drawing.fill();
      }
    }

    function projectedPoint(x, y, currentLayout = layout) {
      const rotated = rotatePoint(x, y);
      return {
        x: currentLayout.centerX + rotated.x * currentLayout.scale,
        y: currentLayout.centerY
          + rotated.y * Math.cos(parameters.inclination * Math.PI / 180) * currentLayout.scale,
      };
    }

    function drawOrbit(drawing, width, height, state) {
      const chartHeight = clamp(height * 0.2, 82, 118);
      const availableHeight = Math.max(150, height - chartHeight);
      const orbitRadius = Math.max(58, Math.min(width * 0.31, availableHeight * 0.34));
      layout = {
        centerX: width * 0.48,
        centerY: availableHeight * 0.47,
        scale: orbitRadius / Math.max(parameters.semiMajor * (1 + parameters.eccentricity), 0.001),
        chartY: height - chartHeight,
        chartHeight,
      };

      drawing.beginPath();
      const root = Math.sqrt(1 - parameters.eccentricity ** 2);
      for (let index = 0; index <= 180; index += 1) {
        const eccentricAnomaly = index / 180 * TAU;
        const point = projectedPoint(
          parameters.semiMajor
            * (Math.cos(eccentricAnomaly) - parameters.eccentricity),
          parameters.semiMajor * root * Math.sin(eccentricAnomaly),
        );
        if (index === 0) drawing.moveTo(point.x, point.y);
        else drawing.lineTo(point.x, point.y);
      }
      drawing.closePath();
      drawing.strokeStyle = "rgba(184, 164, 255, 0.31)";
      drawing.lineWidth = 1;
      drawing.setLineDash([4, 5]);
      drawing.stroke();
      drawing.setLineDash([]);

      const starGlow = drawing.createRadialGradient(
        layout.centerX,
        layout.centerY,
        1,
        layout.centerX,
        layout.centerY,
        36,
      );
      starGlow.addColorStop(0, "rgba(255, 244, 207, 0.95)");
      starGlow.addColorStop(0.16, "rgba(255, 223, 153, 0.55)");
      starGlow.addColorStop(1, "rgba(255, 210, 120, 0)");
      drawing.fillStyle = starGlow;
      drawing.beginPath();
      drawing.arc(layout.centerX, layout.centerY, 36, 0, TAU);
      drawing.fill();

      const angularSemiMajor = parameters.semiMajor / parameters.distancePc * 1000;
      const maskPixels = clamp(
        angularSemiMajor > 0 ? parameters.maskMas / angularSemiMajor * orbitRadius : 8,
        5,
        orbitRadius * 1.35,
      );
      drawing.fillStyle = "rgba(3, 5, 9, 0.96)";
      drawing.strokeStyle = "rgba(184, 164, 255, 0.42)";
      drawing.lineWidth = 1;
      drawing.beginPath();
      drawing.arc(layout.centerX, layout.centerY, maskPixels, 0, TAU);
      drawing.fill();
      drawing.stroke();
      drawing.beginPath();
      drawing.arc(layout.centerX, layout.centerY, maskPixels + 4, 0, TAU);
      drawing.strokeStyle = "rgba(184, 164, 255, 0.11)";
      drawing.stroke();

      const planet = projectedPoint(
        parameters.semiMajor * (Math.cos(state.eccentricAnomaly) - parameters.eccentricity),
        parameters.semiMajor
          * Math.sqrt(1 - parameters.eccentricity ** 2)
          * Math.sin(state.eccentricAnomaly),
      );

      drawing.strokeStyle = "rgba(212, 220, 255, 0.16)";
      drawing.setLineDash([]);
      drawing.beginPath();
      drawing.moveTo(layout.centerX, layout.centerY);
      drawing.lineTo(planet.x, planet.y);
      drawing.stroke();

      for (const [index, observation] of observations.entries()) {
        const point = {
          x: layout.centerX + observation.x * layout.scale,
          y: layout.centerY + observation.y * layout.scale,
        };
        drawing.save();
        drawing.translate(point.x, point.y);
        drawing.strokeStyle = index === observations.length - 1
          ? "#f0ecff"
          : "rgba(184, 164, 255, 0.58)";
        drawing.lineWidth = 1;
        drawing.beginPath();
        drawing.moveTo(-4, 0);
        drawing.lineTo(4, 0);
        drawing.moveTo(0, -4);
        drawing.lineTo(0, 4);
        drawing.stroke();
        drawing.restore();
      }

      const visibility = 0.18 + state.throughput * 0.82;
      drawing.save();
      drawing.globalAlpha = visibility;
      drawing.shadowColor = "#b8a4ff";
      drawing.shadowBlur = 14 * state.throughput;
      drawing.fillStyle = "#e9e4ff";
      drawing.beginPath();
      drawing.arc(planet.x, planet.y, 4.2, 0, TAU);
      drawing.fill();
      drawing.shadowBlur = 0;
      drawing.strokeStyle = "rgba(233, 228, 255, 0.72)";
      drawing.beginPath();
      drawing.arc(planet.x, planet.y, 9, 0, TAU);
      drawing.stroke();
      drawing.restore();

      drawing.fillStyle = "rgba(220, 227, 241, 0.52)";
      drawing.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      drawing.fillText("CORONAGRAPH IMAGE PLANE", 16, 24);
      drawing.fillText(
        `${format(parameters.distancePc, 1)} pc · mask ${format(parameters.maskMas, 0)} mas`,
        16,
        39,
      );

      if (state.transiting) {
        drawing.fillStyle = "rgba(184, 164, 255, 0.12)";
        drawing.fillRect(0, 0, width, layout.chartY);
        drawing.fillStyle = "#d8cdff";
        drawing.fillText("TRANSIT WINDOW", 16, 56);
      }

      layout.planet = planet;
    }

    function drawRadialVelocity(drawing, width, height, state) {
      const left = 18;
      const right = width - 18;
      const top = layout.chartY + 18;
      const bottom = height - 18;
      const middle = (top + bottom) / 2;
      const amplitude = Math.max(1, state.amplitude);

      drawing.fillStyle = "rgba(7, 10, 16, 0.84)";
      drawing.fillRect(0, layout.chartY, width, layout.chartHeight);
      drawing.strokeStyle = "rgba(232, 240, 255, 0.09)";
      drawing.beginPath();
      drawing.moveTo(left, middle);
      drawing.lineTo(right, middle);
      drawing.stroke();

      drawing.beginPath();
      for (let index = 0; index <= 140; index += 1) {
        const sampleTime = index / 140 * state.period;
        const sample = orbitalState(sampleTime);
        const x = left + index / 140 * (right - left);
        const y = middle - sample.radialVelocity / amplitude * (bottom - top) * 0.42;
        if (index === 0) drawing.moveTo(x, y);
        else drawing.lineTo(x, y);
      }
      drawing.strokeStyle = "rgba(184, 164, 255, 0.72)";
      drawing.lineWidth = 1.4;
      drawing.stroke();

      const phaseX = left + state.phase / TAU * (right - left);
      const phaseY = middle - state.radialVelocity / amplitude * (bottom - top) * 0.42;
      drawing.fillStyle = "#f0ecff";
      drawing.beginPath();
      drawing.arc(phaseX, phaseY, 3.2, 0, TAU);
      drawing.fill();

      drawing.fillStyle = "rgba(220, 227, 241, 0.48)";
      drawing.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      drawing.fillText("STELLAR RADIAL VELOCITY", left, layout.chartY + 12);
      drawing.textAlign = "right";
      drawing.fillText(`±${format(amplitude, 1)} m/s`, right, layout.chartY + 12);
      drawing.textAlign = "left";
    }

    function draw() {
      if (destroyed) return;
      const { context: drawing, width, height } = resizeCanvas();
      const state = orbitalState();
      drawing.clearRect(0, 0, width, height);
      drawBackdrop(drawing, width, height);
      drawOrbit(drawing, width, height, state);
      drawRadialVelocity(drawing, width, height, state);
      updateMetrics(state);
    }

    function phaseFromPointer(event) {
      if (!layout) return;
      const point = pointerPosition(event);
      const unrotated = rotatePoint(
        (point.x - layout.centerX) / layout.scale,
        (point.y - layout.centerY)
          / (layout.scale * Math.max(0.06, Math.cos(parameters.inclination * Math.PI / 180))),
        -ORBIT_ROTATION,
      );
      const root = Math.sqrt(1 - parameters.eccentricity ** 2);
      const cosine = clamp(
        unrotated.x / parameters.semiMajor + parameters.eccentricity,
        -1,
        1,
      );
      const sine = clamp(
        unrotated.y / Math.max(parameters.semiMajor * root, 0.0001),
        -1,
        1,
      );
      const eccentricAnomaly = Math.atan2(sine, cosine);
      const meanAnomaly = eccentricAnomaly
        - parameters.eccentricity * Math.sin(eccentricAnomaly);
      const normalized = ((meanAnomaly % TAU) + TAU) % TAU;
      parameters.timeDays = normalized / TAU * periodDays();
      controls.timeDays.set(parameters.timeDays);
      markChanged();
    }

    function onPointerDown(event) {
      if (!layout || event.button !== 0 || event.offsetY >= layout.chartY) return;
      dragging = true;
      dragMoved = false;
      canvas.setPointerCapture?.(event.pointerId);
      phaseFromPointer(event);
    }

    function onPointerMove(event) {
      if (!dragging) return;
      dragMoved = true;
      phaseFromPointer(event);
    }

    function onPointerUp(event) {
      if (!dragging) return;
      dragging = false;
      canvas.releasePointerCapture?.(event.pointerId);
      phaseFromPointer(event);
      recordObservation();
      if (!dragMoved) showToast?.("Astrometric point recorded");
    }

    function onPointerCancel(event) {
      if (!dragging) return;
      dragging = false;
      canvas.releasePointerCapture?.(event.pointerId);
    }

    function onKeyDown(event) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Enter") return;
      event.preventDefault();
      if (event.key === "Enter") {
        recordObservation();
        return;
      }
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      parameters.timeDays = (
        parameters.timeDays + direction + periodDays()
      ) % periodDays();
      controls.timeDays.set(parameters.timeDays);
      markChanged();
    }

    function onResize() {
      draw();
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);

    function frame(now) {
      if (destroyed) return;
      const deltaSeconds = Math.min(0.08, Math.max(0, (now - lastFrameTime) / 1000));
      lastFrameTime = now;
      if (running && !dragging) {
        const period = periodDays();
        parameters.timeDays = (parameters.timeDays + deltaSeconds * parameters.speed) % period;
        controls.timeDays.set(parameters.timeDays);
        tick += 1;
        setTick(tick);
      }
      draw();
      animationFrame = requestAnimationFrame(frame);
    }

    function applyPreset(id) {
      const preset = PRESETS[id] || PRESETS.coronagraph;
      activePreset = PRESETS[id] ? id : "coronagraph";
      parameters = { ...preset };
      observations = [];
      tick = 0;
      syncControls();
      setTick(tick);
      draw();
    }

    function reset() {
      applyPreset(activePreset);
    }

    function setState(next) {
      if (!next || typeof next !== "object") return;
      if (typeof next.preset === "string" && PRESETS[next.preset]) {
        activePreset = next.preset;
      }
      const restored = {};
      for (const [key, bounds] of Object.entries(LIMITS)) {
        restored[key] = bounded(next.parameters?.[key], bounds, parameters[key]);
      }
      parameters = restored;
      observations = Array.isArray(next.observations)
        ? next.observations.slice(-14).map((observation) => ({
          timeDays: bounded(observation.timeDays, LIMITS.timeDays, 0),
          phase: bounded(observation.phase, [0, TAU], 0),
          x: bounded(observation.x, [-20, 20], 0),
          y: bounded(observation.y, [-20, 20], 0),
          radius: bounded(observation.radius, [0, 20], 0),
          rv: bounded(observation.rv, [-100000, 100000], 0),
        }))
        : [];
      syncControls();
      markChanged();
    }

    draw();
    animationFrame = requestAnimationFrame(frame);

    return {
      reset,
      play() {
        running = true;
        lastFrameTime = performance.now();
      },
      pause() {
        running = false;
        draw();
      },
      applyPreset,
      getState() {
        return {
          version: 1,
          preset: activePreset,
          parameters: { ...parameters },
          observations: observations.map((observation) => ({ ...observation })),
        };
      },
      setState,
      destroy() {
        destroyed = true;
        cancelAnimationFrame(animationFrame);
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerCancel);
        canvas.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("resize", onResize);
        setStatus?.("simulation stopped", "paused");
      },
    };
  },
};
