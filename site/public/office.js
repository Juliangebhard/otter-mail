// The landing page's hero: Otter Mail as a small office, in glass. Mail comes in
// through the wall from Gmail and IMAP, and the receptionist sorts it: junk into the
// shredder, labeled mail into the pigeonholes, the rest onto the counter for you. A
// courier walks it to your desk, where you read it (J) and file it (E) or pass it
// to the agent next door (R), whose reply you send (⌘↩) and the courier posts. Your
// Mac, your iPhone and the meeting room's screen show the same inbox. A plain canvas
// and an orthographic camera.

(() => {
  const root = document.querySelector(".office");
  const canvas = root?.querySelector("canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const toggle = root.querySelector("button");

  // ── The look ────────────────────────────────────────────────────────────────

  const INK = "44, 54, 72";
  const GLASS = "140, 164, 196";
  const BLUE = "47, 124, 246";
  const LABELS = { northwind: "142, 99, 206", hiring: "222, 132, 28", finance: "28, 150, 108" };
  const AVATARS = ["142, 99, 206", "47, 124, 246", "222, 132, 28", "28, 150, 108", "214, 80, 92"];
  // People and things: muted, solid colors (the glass is for the building).
  const SKIN = ["244, 214, 188", "226, 184, 150", "198, 148, 110", "152, 106, 74", "116, 80, 56"];
  const HAIR = ["46, 38, 34", "104, 74, 52", "196, 156, 102", "176, 176, 182", "30, 28, 28"];
  const SHIRTS = {
    violet: "128, 114, 172",
    amber: "206, 146, 78",
    navy: "62, 80, 112",
    sage: "116, 154, 132",
    rose: "192, 124, 124",
    slate: "118, 138, 172",
    sand: "204, 178, 132",
    plum: "142, 112, 150",
  };
  const PANTS = ["58, 64, 78", "92, 102, 122", "150, 138, 118"];
  const LEAF = ["96, 142, 104", "122, 170, 128"];
  const OAK = "226, 208, 182";
  const CHAIR = "84, 90, 104";
  const SCREEN = "196, 201, 210";
  const SANS = '-apple-system, BlinkMacSystemFont, "Inter Variable", Inter, system-ui, sans-serif';
  const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

  const look = (tint, top, front, side, edge, back = 0) => ({ tint, top, front, side, edge, back });
  const tone = (rgb, k) =>
    rgb
      .split(",")
      .map((v) => Math.round(k > 1 ? +v + (255 - +v) * (k - 1) : +v * k))
      .join(", ");
  /** Something solid: lit from above, a little darker on the side. */
  const solid = (rgb, edge = 0.4) => ({
    ...look(rgb, 1, 1, 1, edge),
    tints: [tone(rgb, 1.16), rgb, tone(rgb, 0.86)],
  });
  const GLASS_S = look(GLASS, 0.06, 0.09, 0.14, 0.38, 0.08);
  const PANE_S = look(GLASS, 0.03, 0.045, 0.07, 0.28, 0.04);
  const FLOOR_S = look("236, 233, 227", 0.5, 0.8, 0.9, 0.22);
  const WALL_S = solid("246, 244, 240", 0.28);
  const WHITE_S = solid("252, 252, 251", 0.42);
  const AGENT_S = look(BLUE, 0.3, 0.26, 0.36, 0.55);
  const JUNK_S = solid("226, 228, 232", 0.38);
  const tinted = (s, rgb) => ({ ...s, ink: rgb, edge: 0.7 });

  const rgba = (rgb, a) => `rgba(${rgb}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const add = (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const mul = (p, k) => [p[0] * k, p[1] * k, p[2] * k];
  const mix = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t)];
  const cross = (p, q) => [
    p[1] * q[2] - p[2] * q[1],
    p[2] * q[0] - p[0] * q[2],
    p[0] * q[1] - p[1] * q[0],
  ];
  const unit = (p) => mul(p, 1 / (Math.hypot(...p) || 1));
  const turnTo = (a, b, t) =>
    a + (((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI) * t;

  // Always the same office: a small seeded random.
  let seed = 7;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // ── The camera: orthographic, looking into the office from the front ─────────

  const YAW = 0.2;
  const PITCH = 0.62;
  const CY = Math.cos(YAW);
  const SY = Math.sin(YAW);
  const SP = Math.sin(PITCH);
  const CP = Math.cos(PITCH);
  const TOWARD = [SY * CP, CY * CP, SP];
  let u = 20; // device pixels per world unit
  let ox = 0;
  let oy = 0;
  let px = 1; // device pixels per CSS pixel

  const project = ([x, y, z]) => {
    const xr = x * CY - y * SY;
    const yr = x * SY + y * CY;
    return [ox + xr * u, oy + (yr * SP - z * CP) * u, yr * CP + z * SP];
  };
  const vector = ([x, y, z]) => [(x * CY - y * SY) * u, ((x * SY + y * CY) * SP - z * CP) * u];
  // The back of the office fades a little.
  const fog = (depth) => clamp(0.82 + ((depth + 10) / 20) * 0.18, 0.82, 1);

  // ── Drawing: everything is queued with its depth, then painted back to front ─

  let queue = [];
  const later = (depth, draw) => queue.push({ depth, draw });
  const FLOOR = -1e6;
  const TOP = 1e6;

  function path(points) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }
  function dot(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }

  const FACES = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [3, 2, 6, 7],
    [0, 3, 7, 4],
    [1, 2, 6, 5],
  ];
  const EDGES = [
    [0, 1, 0, 2],
    [1, 2, 0, 5],
    [2, 3, 0, 3],
    [3, 0, 0, 4],
    [4, 5, 1, 2],
    [5, 6, 1, 5],
    [6, 7, 1, 3],
    [7, 4, 1, 4],
    [0, 4, 2, 4],
    [1, 5, 2, 5],
    [2, 6, 3, 5],
    [3, 7, 3, 4],
  ];

  /** A box from a corner and its three edges, in any orientation. */
  function block(o, a, b, c, s, { alpha = 1, depth } = {}) {
    const base = [o, add(o, a), add(add(o, a), b), add(o, b)];
    const pts = [...base, ...base.map((p) => add(p, c))].map(project);
    const normals = [mul(c, -1), c, mul(b, -1), b, mul(a, -1), a];
    const shown = normals.map((n) => n[0] * TOWARD[0] + n[1] * TOWARD[1] + n[2] * TOWARD[2] > 1e-9);
    const middle = pts.reduce((sum, p) => sum + p[2], 0) / 8;
    later(depth ?? middle, () => {
      const f = fog(middle) * alpha;
      if (s.back) {
        ctx.strokeStyle = rgba(INK, s.back * f);
        ctx.beginPath();
        for (const [i, j, fa, fb] of EDGES) {
          if (shown[fa] || shown[fb]) continue;
          ctx.moveTo(pts[i][0], pts[i][1]);
          ctx.lineTo(pts[j][0], pts[j][1]);
        }
        ctx.stroke();
      }
      FACES.forEach((face, k) => {
        if (!shown[k]) return;
        const [nx, ny, nz] = normals[k];
        const up = nz / Math.hypot(nx, ny, nz);
        const kind = up > 0.5 ? 0 : Math.abs(nx) > Math.abs(ny) ? 2 : 1;
        ctx.fillStyle = rgba(s.tints?.[kind] ?? s.tint, [s.top, s.front, s.side][kind] * f);
        path(face.map((i) => pts[i]));
        ctx.fill();
      });
      ctx.strokeStyle = rgba(s.ink ?? INK, s.edge * f);
      ctx.beginPath();
      for (const [i, j, fa, fb] of EDGES) {
        if (!shown[fa] && !shown[fb]) continue;
        ctx.moveTo(pts[i][0], pts[i][1]);
        ctx.lineTo(pts[j][0], pts[j][1]);
      }
      ctx.stroke();
    });
  }
  const box = (x, y, z, w, d, h, s, opts) =>
    block([x, y, z], [w, 0, 0], [0, d, 0], [0, 0, h], s, opts);
  /** A platform: drawn before anything standing on it. */
  const slab = (x, y, z, w, d, h, s) =>
    box(x, y, z, w, d, h, s, { depth: project([x + w / 2, y, z + h])[2] - 0.3 });

  /** A box between two points, square in section (an arm, a leg). */
  function limb(p, q, w, s) {
    const d = sub(q, p);
    let side = cross(d, [0, 0, 1]);
    if (Math.hypot(...side) < 1e-6) side = [1, 0, 0];
    side = mul(unit(side), w);
    const up = mul(unit(cross(side, d)), w);
    block(sub(sub(p, mul(side, 0.5)), mul(up, 0.5)), d, side, up, s);
  }

  function hull(points) {
    const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross2 = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    const upper = [];
    for (const q of p) {
      while (lower.length > 1 && cross2(lower.at(-2), lower.at(-1), q) <= 0) lower.pop();
      lower.push(q);
    }
    for (let i = p.length - 1; i >= 0; i--) {
      while (upper.length > 1 && cross2(upper.at(-2), upper.at(-1), p[i]) <= 0) upper.pop();
      upper.push(p[i]);
    }
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
  }

  function cylinder(x, y, z, r, h, s) {
    const ring = (zz) =>
      Array.from({ length: 18 }, (_, i) =>
        project([
          x + r * Math.cos((i / 18) * Math.PI * 2),
          y + r * Math.sin((i / 18) * Math.PI * 2),
          zz,
        ]),
      );
    const bottom = ring(z);
    const top = ring(z + h);
    const depth = project([x, y, z + h / 2])[2];
    later(depth, () => {
      const f = fog(depth);
      const outline = hull([...bottom, ...top]);
      ctx.fillStyle = rgba(s.tints?.[1] ?? s.tint, s.side * f);
      path(outline);
      ctx.fill();
      ctx.fillStyle = rgba(s.tints?.[0] ?? s.tint, s.top * f);
      path(top);
      ctx.fill();
      ctx.strokeStyle = rgba(s.ink ?? INK, s.edge * f);
      path(outline);
      ctx.stroke();
      path(top);
      ctx.stroke();
    });
  }

  /** A soft shadow on the floor. */
  function shadow(x, y, r, alpha = 0.16) {
    plane(
      [x, y, 0.005],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0],
      () => {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, rgba(INK, alpha));
        g.addColorStop(1, rgba(INK, 0));
        ctx.fillStyle = g;
        dot(0, 0, r);
        ctx.fill();
      },
      FLOOR + 2,
    );
  }

  /** A ball (a sphere is a circle from every side). */
  function ball(x, y, z, r, rgb, alpha = 0.9, edge = 0.5) {
    const [sx, sy, depth] = project([x, y, z]);
    later(depth, () => {
      const f = fog(depth);
      dot(sx, sy, r * u);
      ctx.fillStyle = rgba(rgb, alpha * f);
      ctx.fill();
      ctx.strokeStyle = rgba(INK, edge * f);
      ctx.stroke();
    });
  }

  /**
   * Draws in a plane in the room: local x runs along `right`, local y along `down`
   * (world vectors per local unit), from `o`; `size` (local units) places its depth.
   */
  function plane(o, right, down, size, draw, depth) {
    const middle = project(add(add(o, mul(right, size[0] / 2)), mul(down, size[1] / 2)))[2];
    const [x, y] = project(o);
    const r = vector(right);
    const dn = vector(down);
    later(depth ?? middle, () => {
      ctx.save();
      ctx.setTransform(r[0], r[1], dn[0], dn[1], x, y);
      draw(fog(middle));
      ctx.restore();
    });
  }
  const FRONT_FACE = [
    [1, 0, 0],
    [0, 0, -1],
  ];

  /** Lettering on a face (the front of something, by default). */
  function letters(
    o,
    text,
    size,
    rgb,
    alpha,
    { right = [1, 0, 0], down = [0, 0, -1], depth } = {},
  ) {
    const k = size / 10;
    plane(
      o,
      mul(right, k),
      mul(down, k),
      [text.length * 7, 10],
      (f) => {
        ctx.font = `600 10px ${MONO}`;
        ctx.textBaseline = "top";
        if ("letterSpacing" in ctx) ctx.letterSpacing = "1.5px";
        ctx.fillStyle = rgba(rgb, alpha * f);
        ctx.fillText(text, 0, 0);
      },
      depth,
    );
  }

  /** A keycap that pops up over someone's head as they press it. */
  function keycap(p, text, age) {
    if (age < 0 || age > 1.3) return;
    const [sx, sy] = project([p.x, p.y, (p.sitting ? 1.95 : 2.35) + age * 0.3]);
    later(TOP, () => {
      const a = clamp(age / 0.12, 0, 1) * clamp((1.3 - age) / 0.35, 0, 1);
      const k = u / 33;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(k, k);
      ctx.font = `600 12px ${SANS}`;
      const w = Math.max(22, ctx.measureText(text).width + 14);
      ctx.fillStyle = rgba(INK, 0.22 * a);
      roundRect(-w / 2, -21, w, 24, 5);
      ctx.fill();
      ctx.fillStyle = rgba("255, 255, 255", a);
      roundRect(-w / 2, -24, w, 23, 5);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(INK, 0.5 * a);
      ctx.stroke();
      ctx.fillStyle = rgba(INK, 0.9 * a);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 0, -12);
      ctx.restore();
    });
  }

  // ── The floor plan (x along the office, y toward you, z up) ─────────────────

  const DESK_Z = 0.85;
  const WALL_Y = -8;
  const SLOTS = { gmail: -14.5, imap: -12.5 };
  const SLOT_Z = 2.25;
  const BASKET = [-13.5, -7.45, 0.92];
  const LEDGE = 1.15;
  const COUNTER_Y = -3.95;
  const TO_YOU = [-11.2, COUNTER_Y];
  const BELL = [-15.2, COUNTER_Y];
  const SHREDDER = [-16.55, -6.3];
  const HOLES = { x: -11.1, y: -7.95, w: 1.25, h: 0.62, z: 0.55 };
  const COLUMNS = ["northwind", "hiring", "finance"];
  const COURIER_HOME = [-8.7, -2.8];
  const PICKUP = [-11.2, -3.15];
  const POSTBOX = [-13.6, 0.4];
  const AISLE = 1.5;
  const MEETING = { x0: -4, x1: 4.2, y: -3.4 };
  const OFFICE = { x0: 5.4, x1: 17.6, y: -1.6 };
  const DOOR_X = 10.2;
  const DESK = { x: 10.4, y: -6.95, w: 5, d: 1.4 };
  const INBOX = [11.6, -5.9];
  const OUTBOX = [14.2, -5.9];
  const INBOX_STOP = [10.5, -5.2];
  const OUTBOX_STOP = [15.2, -5.2];
  const BEHIND = -3.6;
  const CABINET = { x: 15.9, y: -7.95 };
  const AGENT_DESK = { x: 6, y: -6.95, w: 3.4, d: 1.3 };
  const AGENT_TRAY = [6.6, -6.05];

  const trayTop = ([x, y], z, list) => [x, y, z + 0.16 + list.length * 0.055];

  // A skyline through the windows, and what's already in the pigeonholes.
  const skyline = Array.from({ length: 16 }, (_, i) => ({
    x: i * 1.55 + random() * 0.5,
    w: 0.9 + random() * 1.1,
    h: 0.6 + random() * 2.1,
  }));
  const pigeonholes = Array.from({ length: 12 }, (_, i) => (i < 3 ? 1 : Math.floor(random() * 4)));

  function room(t) {
    // The floor, with rugs where people sit.
    const [fx, fy, fw, fd] = [-22, -8.4, 43, 15];
    box(fx, fy, -0.5, fw, fd, 0.5, FLOOR_S, { depth: FLOOR });
    plane(
      [fx, fy, 0],
      [1, 0, 0],
      [0, 1, 0],
      [fw, fd],
      (f) => {
        ctx.lineWidth = 0.02;
        ctx.strokeStyle = rgba(INK, 0.06 * f);
        ctx.beginPath();
        for (let x = 1; x < fw; x += 1.5) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, fd);
        }
        for (let y = 0.4; y < fd; y += 1.5) {
          ctx.moveTo(0, y);
          ctx.lineTo(fw, y);
        }
        ctx.stroke();
        const rug = (x, y, w, d, rgb) => {
          ctx.fillStyle = rgba(rgb, 0.16 * f);
          roundRect(x - fx, y - fy, w, d, 0.3);
          ctx.fill();
        };
        rug(-0.4, 1.9, 7.6, 4.2, "196, 178, 150");
      },
      FLOOR + 1,
    );

    walls(t);
    reception();
    openPlan(t);
    meetingRoom();
    yourOffice(t);
    lounge(t);
    for (const [x, y, s] of [
      [-8.8, -0.4, 1],
      [4.8, -4.6, 1.1],
      [16.9, -2.4, 1.2],
      [-0.5, 2.5, 0.9],
      [7.4, 2.5, 1],
    ]) {
      plant(x, y, s, t);
    }
  }

  function walls(t) {
    // Solid behind reception and the coffee; windows onto the city after.
    box(-22, WALL_Y - 0.4, 0, 18, 0.4, 4.2, WALL_S, { depth: FLOOR + 3 });
    box(-4, WALL_Y - 0.4, 0, 25, 0.4, 4.2, PANE_S, { depth: FLOOR + 3 });
    plane(
      [-4, WALL_Y, 4.2],
      ...FRONT_FACE,
      [25, 4.2],
      (f) => {
        for (const b of skyline) {
          ctx.fillStyle = rgba(GLASS, 0.07 * f);
          ctx.fillRect(b.x, 3.4 - b.h, b.w, b.h);
          ctx.fillStyle = rgba(GLASS, 0.12 * f);
          for (let wy = 3.4 - b.h + 0.18; wy < 3.25; wy += 0.3) {
            for (let wx = b.x + 0.15; wx < b.x + b.w - 0.1; wx += 0.28)
              ctx.fillRect(wx, wy, 0.1, 0.12);
          }
        }
        ctx.lineWidth = 0.04;
        ctx.strokeStyle = rgba(INK, 0.28 * f);
        ctx.beginPath();
        for (let x = 0; x <= 25; x += 2.5) {
          ctx.moveTo(x, 0.4);
          ctx.lineTo(x, 3.4);
        }
        ctx.moveTo(0, 0.4);
        ctx.lineTo(25, 0.4);
        ctx.moveTo(0, 3.4);
        ctx.lineTo(25, 3.4);
        ctx.stroke();
      },
      FLOOR + 4,
    );
    letters([-17.6, WALL_Y + 0.01, 3.75], "OTTER MAIL", 0.5, INK, 0.7, { depth: FLOOR + 4 });

    // A clock over the coffee.
    plane(
      [-6, WALL_Y + 0.01, 3.2],
      [1, 0, 0],
      [0, 0, -1],
      [0, 0],
      (f) => {
        dot(0, 0, 0.42);
        ctx.fillStyle = rgba("255, 255, 255", f);
        ctx.fill();
        ctx.lineWidth = 0.05;
        ctx.strokeStyle = rgba(INK, 0.6 * f);
        ctx.stroke();
        for (const [len, turns] of [
          [0.22, t / 48],
          [0.33, t / 4],
        ]) {
          const a = turns * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.sin(a) * len, -Math.cos(a) * len);
          ctx.stroke();
        }
      },
      FLOOR + 5,
    );
  }

  function reception() {
    // Mail slots in the wall, the basket under them, and the pigeonholes.
    for (const [name, x] of Object.entries(SLOTS)) {
      box(x - 0.5, WALL_Y, SLOT_Z, 1, 0.16, 0.26, WHITE_S);
      plane([x - 0.38, WALL_Y + 0.17, SLOT_Z + 0.17], ...FRONT_FACE, [0.76, 0.08], (f) => {
        ctx.fillStyle = rgba(INK, 0.6 * f);
        ctx.fillRect(0, 0, 0.76, 0.07);
      });
      letters([x - 0.42, WALL_Y + 0.01, SLOT_Z + 0.72], name.toUpperCase(), 0.26, INK, 0.75, {
        depth: FLOOR + 5,
      });
    }
    box(-15.8, WALL_Y, 0, 4.4, 0.9, 0.9, WHITE_S);
    box(BASKET[0] - 0.7, BASKET[1] - 0.38, BASKET[2], 1.4, 0.76, 0.34, tinted(GLASS_S, INK));

    const { x, y, w, h, z } = HOLES;
    box(x, y, 0, w * 3 + 0.1, 0.6, z + h * 4 + 0.05, solid(OAK));
    plane([x + 0.05, y + 0.61, z + h * 4], ...FRONT_FACE, [w * 3, h * 4], (f) => {
      ctx.lineWidth = 0.03;
      ctx.strokeStyle = rgba(INK, 0.4 * f);
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 3; c++) {
          ctx.fillStyle = rgba(GLASS, 0.12 * f);
          ctx.fillRect(c * w + 0.05, r * h + 0.05, w - 0.1, h - 0.1);
          ctx.strokeRect(c * w + 0.05, r * h + 0.05, w - 0.1, h - 0.1);
          const n = r === 0 ? holes[COLUMNS[c]] : pigeonholes[r * 3 + c];
          for (let i = 0; i < Math.min(n, 4); i++) {
            ctx.fillStyle = rgba("255, 255, 255", f);
            ctx.fillRect(c * w + 0.18 + i * 0.05, r * h + 0.16 + i * 0.03, w - 0.36, h - 0.24);
            ctx.strokeRect(c * w + 0.18 + i * 0.05, r * h + 0.16 + i * 0.03, w - 0.36, h - 0.24);
          }
          if (r === 0) {
            ctx.fillStyle = rgba(LABELS[COLUMNS[c]], 0.9 * f);
            ctx.fillRect(c * w + 0.05, r * h + h - 0.12, w - 0.1, 0.07);
          }
        }
      }
    });
    letters([x + 0.1, y + 0.01, z + h * 4 + 0.62], "LABELS", 0.26, INK, 0.7, { depth: FLOOR + 5 });
    COLUMNS.forEach((name, c) => {
      letters(
        [x + c * w + 0.1, y + 0.62, z + h * 4 + 0.22],
        name.toUpperCase(),
        0.13,
        LABELS[name],
        0.95,
        {
          depth: project([x + c * w, y + 0.6, z + h * 4])[2] + 0.1,
        },
      );
    });

    // The reception desk, its counter, the bell, the tray for you.
    box(-16, -5.3, 0, 5.8, 1.15, DESK_Z, WHITE_S);
    box(-16.2, -4.15, 0, 6.2, 0.4, LEDGE, solid(OAK));
    box(-16.3, -4.2, LEDGE, 6.4, 0.5, 0.06, WHITE_S);
    cylinder(BELL[0], BELL[1], LEDGE + 0.06, 0.2, 0.05, WHITE_S);
    ball(BELL[0], BELL[1], LEDGE + 0.2, 0.15, "236, 200, 120", 0.95);
    const age = now - ding;
    if (age < 1) {
      plane([BELL[0], BELL[1], LEDGE + 0.2], [1, 0, 0], [0, 1, 0], [0, 0], (f) => {
        ctx.lineWidth = 0.04;
        ctx.strokeStyle = rgba(BLUE, (1 - age) * 0.7 * f);
        dot(0, 0, 0.3 + age * 0.7);
        ctx.stroke();
      });
    }
    box(TO_YOU[0] - 0.55, TO_YOU[1] - 0.36, LEDGE + 0.06, 1.1, 0.72, 0.12, tinted(GLASS_S, BLUE));
    letters([TO_YOU[0] - 0.5, COUNTER_Y + 0.26, LEDGE - 0.12], "FOR YOU", 0.2, BLUE, 0.85);

    // The shredder takes the junk.
    box(SHREDDER[0] - 0.4, SHREDDER[1] - 0.3, 0, 0.8, 0.6, 0.9, GLASS_S);
    box(SHREDDER[0] - 0.42, SHREDDER[1] - 0.32, 0.9, 0.84, 0.64, 0.12, WHITE_S);
    letters([SHREDDER[0] - 0.3, SHREDDER[1] + 0.31, 0.75], "JUNK", 0.18, INK, 0.7);
    const shredAge = now - shredded;
    for (let i = 0; i < 6; i++) {
      const fall = clamp(shredAge * 1.2 - i * 0.05, 0, 1);
      box(
        SHREDDER[0] - 0.3 + i * 0.1,
        SHREDDER[1] - 0.05,
        0.85 - fall * 0.7,
        0.04,
        0.02,
        0.18,
        WHITE_S,
        {
          alpha: shredAge < 1.2 ? 1 : 0.4,
        },
      );
    }

    // The postbox, for replies on their way out.
    shadow(POSTBOX[0], POSTBOX[1], 0.75);
    cylinder(POSTBOX[0], POSTBOX[1], 0, 0.48, 1.25, solid("196, 92, 90"));
    cylinder(POSTBOX[0], POSTBOX[1], 1.25, 0.56, 0.12, solid("176, 80, 78"));
    plane([POSTBOX[0] - 0.22, POSTBOX[1] + 0.49, 1.05], ...FRONT_FACE, [0.44, 0.1], (f) => {
      ctx.fillStyle = rgba(INK, 0.7 * f);
      ctx.fillRect(0, 0, 0.44, 0.07);
    });
    letters([POSTBOX[0] - 0.2, POSTBOX[1] + 0.49, 0.8], "POST", 0.15, "255, 255, 255", 0.95);
  }

  function openPlan() {
    // Two desks facing each other.
    box(-7.6, -1.9, 0, 4.4, 1.6, DESK_Z, WHITE_S);
    box(-7.6, -1.13, DESK_Z, 4.4, 0.06, 0.45, GLASS_S);
    monitor([-6.5, -1.4, DESK_Z], -1, "back");
    monitor([-4.7, -0.7, DESK_Z], 1, "doc");

    // The coffee.
    box(-7.5, WALL_Y, 0, 3.3, 0.85, 0.95, WHITE_S);
    box(-7.2, WALL_Y + 0.1, 0.95, 0.8, 0.6, 0.9, solid("72, 76, 86", 0.5));
    box(-7.05, WALL_Y + 0.55, 1.25, 0.5, 0.18, 0.3, WHITE_S);
    cylinder(-5.3, WALL_Y + 0.5, 0.95, 0.1, 0.16, WHITE_S);
    steam(-6.8, WALL_Y + 0.65, 1.9);
  }

  function steam(x, y, z) {
    for (let i = 0; i < 3; i++) {
      const age = (now * 0.5 + i / 3) % 1;
      plane([x + (i - 1) * 0.08, y, z + age * 0.6], [0.01, 0, 0], [0, 0, -0.01], [0, 0], (f) => {
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = rgba(INK, 0.25 * (1 - age) * f);
        ctx.beginPath();
        for (let k = 0; k <= 10; k++) {
          const yy = -k * 3;
          const xx = Math.sin(k * 0.8 + now * 3 + i) * 3;
          if (k) ctx.lineTo(xx, yy);
          else ctx.moveTo(xx, yy);
        }
        ctx.stroke();
      });
    }
  }

  function meetingRoom() {
    const { x0, x1, y } = MEETING;
    box(x0, WALL_Y, 0, 0.08, y - WALL_Y, 2.5, PANE_S);
    box(x1, WALL_Y, 0, 0.08, y - WALL_Y, 2.5, PANE_S);
    box(x0, y, 0, 4, 0.08, 2.5, PANE_S);
    box(x0 + 5.5, y, 0, x1 - x0 - 5.5, 0.08, 2.5, PANE_S);
    box(-2.2, -6.6, 0, 4.6, 1.8, 0.78, WHITE_S);
    // The screen on the wall shows the inbox, in a browser.
    box(-1.1, WALL_Y + 0.1, 0, 0.3, 0.3, 1.2, WHITE_S);
    block([-2.3, WALL_Y + 0.15, 1.2], [3.2, 0, 0], [0, 0.1, 0], [0, 0, 1.7], WHITE_S);
    screen([-2.2, WALL_Y + 0.26, 2.82], [1, 0, 0], [0, 0, -1], 3, 1.54, "web");
  }

  function agentDesk(t) {
    const { x, y, w, d } = AGENT_DESK;
    box(x, y, 0, w, d, DESK_Z, WHITE_S);
    box(AGENT_TRAY[0] - 0.45, AGENT_TRAY[1] - 0.35, DESK_Z, 0.9, 0.7, 0.12, tinted(GLASS_S, BLUE));
    monitor([x + 1.95, y + 0.4, DESK_Z], 1, "agent", t);
    // A tent card with its name.
    block([x + 2.45, y + 0.9, DESK_Z], [0.75, 0, 0], [0, 0.18, 0], [0, -0.09, 0.32], WHITE_S);
    letters([x + 2.53, y + 1, DESK_Z + 0.27], "AGENT", 0.13, BLUE, 0.95);
  }

  function yourOffice(t) {
    const { x0, x1, y } = OFFICE;
    box(x0, WALL_Y, 0, 0.08, y - WALL_Y, 2.6, PANE_S);
    box(x0, y, 0, DOOR_X - 0.8 - x0, 0.08, 2.6, PANE_S);
    box(DOOR_X + 0.8, y, 0, x1 - DOOR_X - 0.8, 0.08, 2.6, PANE_S);
    letters([DOOR_X + 1.05, y + 0.09, 2.15], "YOU", 0.32, INK, 0.75);
    agentDesk(t);

    const { x, y: dy, w, d } = DESK;
    box(x, dy, 0, w, d, DESK_Z, WHITE_S);
    box(INBOX[0] - 0.45, INBOX[1] - 0.35, DESK_Z, 0.9, 0.7, 0.12, tinted(GLASS_S, BLUE));
    box(OUTBOX[0] - 0.45, OUTBOX[1] - 0.35, DESK_Z, 0.9, 0.7, 0.12, tinted(GLASS_S, INK));
    letters([INBOX[0] - 0.4, INBOX[1] + 0.36, DESK_Z + 0.1], "INBOX", 0.1, BLUE, 0.9);
    letters([OUTBOX[0] - 0.4, OUTBOX[1] + 0.36, DESK_Z + 0.1], "SEND", 0.1, INK, 0.8);
    monitor([x + w / 2, dy + 0.4, DESK_Z], 1, "mac");
    box(x + w / 2 - 0.5, dy + 1, DESK_Z, 1, 0.36, 0.04, WHITE_S);
    // The iPhone, face up.
    slab(x + w - 0.6, dy + 0.55, DESK_Z, 0.36, 0.64, 0.04, solid(SCREEN, 0.5));
    plane(
      [x + w - 0.57, dy + 0.58, DESK_Z + 0.045],
      [0.003, 0, 0],
      [0, 0.003, 0],
      [100, 193],
      (f) => {
        ctx.fillStyle = rgba("248, 250, 253", f);
        ctx.fillRect(0, 0, 100, 193);
        const flash = now - notified;
        ctx.fillStyle = rgba(INK, 0.3 * f);
        for (let i = 0; i < 5; i++) ctx.fillRect(14, 40 + i * 26, 60 - (i % 2) * 18, 6);
        if (flash < 2) {
          const a = clamp(flash / 0.2, 0, 1) * clamp((2 - flash) / 0.4, 0, 1);
          ctx.fillStyle = rgba("255, 255, 255", a * f);
          roundRect(6, 8, 88, 30, 8);
          ctx.fill();
          ctx.strokeStyle = rgba(BLUE, 0.6 * a * f);
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = rgba(BLUE, a * f);
          dot(18, 23, 5);
          ctx.fill();
          ctx.fillStyle = rgba(INK, 0.5 * a * f);
          ctx.fillRect(28, 17, 50, 5);
          ctx.fillRect(28, 26, 36, 4);
        }
      },
    );

    // The archive.
    const { x: cx, y: cy } = CABINET;
    shadow(cx + 0.75, cy + 0.65, 1.1, 0.1);
    box(cx, cy, 0, 1.5, 1.3, 1.7, solid("214, 218, 224"));
    for (let i = 0; i < 3; i++) {
      const out = i === 2 ? ease(drawer) * 0.7 : 0;
      box(cx + 0.08, cy + 0.05 + out, 0.08 + i * 0.54, 1.34, 1.22, 0.48, solid("230, 233, 238"));
      box(cx + 0.55, cy + 1.27 + out, 0.3 + i * 0.54, 0.4, 0.05, 0.08, WHITE_S);
    }
    letters([cx + 0.15, cy + 1.31, 1.68], "ARCHIVE", 0.17, INK, 0.75);
  }

  function lounge() {
    const tone = solid("196, 190, 182");
    box(0.6, 2.2, 0.12, 4.8, 0.32, 1.05, tone);
    box(0.6, 2.52, 0.12, 4.8, 0.95, 0.32, tone);
    box(0.3, 2.2, 0.12, 0.3, 1.27, 0.7, tone);
    box(5.4, 2.2, 0.12, 0.3, 1.27, 0.7, tone);
    for (const x of [0.4, 5.5]) for (const y of [2.3, 3.35]) box(x, y, 0, 0.1, 0.1, 0.12, WHITE_S);
    box(1.8, 4.1, 0, 2.6, 1, 0.42, WHITE_S);
    cylinder(2.4, 4.55, 0.42, 0.11, 0.16, WHITE_S);
    steam(2.4, 4.55, 0.62);
  }

  function plant(x, y, s, t) {
    shadow(x, y, 0.55 * s);
    cylinder(x, y, 0, 0.3 * s, 0.5 * s, solid("238, 234, 228"));
    const leaves = [
      [-0.05, -0.12, 1.25, 0.3, 0],
      [0.18, -0.05, 1.05, 0.28, 0],
      [-0.22, 0.02, 0.95, 0.27, 0],
      [0.02, 0.1, 0.85, 0.3, 1],
      [0.2, 0.16, 1.15, 0.24, 1],
      [-0.12, 0.18, 1.3, 0.22, 1],
    ];
    leaves.forEach(([dx, dy, z, r, light], i) => {
      const sway = Math.sin(t * 0.9 + i + x) * 0.025;
      ball(x + (dx + sway) * s, y + dy * s, z * s, r * s, LEAF[light], 1, 0.3);
    });
  }

  /** A monitor on a desk, its screen facing +y (dir 1) or away (-1). */
  function monitor([x, y, z], dir, kind, t) {
    const body = solid(SCREEN, 0.5);
    box(x - 0.08, y - 0.08, z, 0.16, 0.16, 0.3, body);
    box(x - 0.3, y - 0.2, z, 0.6, 0.4, 0.04, body);
    const w = kind === "mac" ? 2.2 : 1.7;
    const h = kind === "mac" ? 1.3 : 1;
    block([x - w / 2, y - 0.04, z + 0.25], [w, 0, 0], [0, 0.08, 0], [0, 0, h], body);
    if (dir > 0)
      screen(
        [x - w / 2 + 0.07, y + 0.05, z + 0.25 + h - 0.07],
        [1, 0, 0],
        [0, 0, -1],
        w - 0.14,
        h - 0.14,
        kind,
        t,
      );
  }

  /** What a screen shows: the shared inbox, the agent writing, or a document. */
  function screen(o, right, down, w, h, kind, t) {
    plane(o, mul(right, 0.01), mul(down, 0.01), [w * 100, h * 100], (f) => {
      const W = w * 100;
      const H = h * 100;
      ctx.fillStyle = rgba("250, 251, 253", f);
      ctx.fillRect(0, 0, W, H);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = rgba(INK, 0.2 * f);
      ctx.strokeRect(0, 0, W, H);
      if (kind === "doc") {
        ctx.fillStyle = rgba(INK, 0.25 * f);
        for (let i = 0; i < 6; i++)
          ctx.fillRect(16, 14 + i * 13, (i % 3 === 2 ? 0.5 : 0.85) * (W - 32), 5);
        return;
      }
      if (kind === "agent") {
        const k = agent.mail ? agent.t : 0;
        ctx.fillStyle = rgba(INK, 0.12 * clamp((k - 0.1) / 0.3, 0, 1) * f);
        roundRect(W - 90, 8, 80, 18, 7);
        ctx.fill();
        [120, 96, 130, 80].forEach((lw, i) => {
          const p = clamp((k - 0.5 - i * 0.45) / 0.45, 0, 1);
          if (p <= 0) return;
          ctx.fillStyle = rgba(INK, 0.35 * f);
          ctx.fillRect(10, 36 + i * 13, Math.min(lw, W - 20) * p, 5);
        });
        if (agent.mail && k < 2.6) {
          ctx.fillStyle = rgba(BLUE, (0.5 + 0.5 * Math.sin(t * 8)) * f);
          ctx.fillRect(10, H - 16, 7, 7);
        }
        return;
      }
      let left = 0;
      let top = 0;
      if (kind === "mac") {
        // The rail of mailboxes, then the list.
        ctx.fillStyle = rgba(INK, 0.05 * f);
        ctx.fillRect(0, 0, 18, H);
        AVATARS.slice(0, 3).forEach((rgb, i) => {
          ctx.fillStyle = rgba(rgb, 0.7 * f);
          roundRect(5, 8 + i * 14, 8, 8, 2);
          ctx.fill();
        });
        left = 18;
        top = 8;
      } else {
        ctx.fillStyle = rgba(INK, 0.05 * f);
        ctx.fillRect(0, 0, W, 14);
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = rgba(INK, 0.18 * f);
          dot(7 + i * 6, 7, 2);
          ctx.fill();
        }
        ctx.fillStyle = rgba(INK, 0.08 * f);
        roundRect(W / 2 - 50, 3, 100, 8, 4);
        ctx.fill();
        top = 18;
      }
      const rowH = 18;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, W - left, H - top);
      ctx.clip();
      for (const r of rows) {
        const y = top + r.y * rowH;
        if (y > H) continue;
        const a = r.a * f;
        const inner = W - left - 34;
        if (r.active) {
          ctx.fillStyle = rgba(BLUE, 0.1 * a);
          ctx.fillRect(left, y, W - left, rowH);
        }
        ctx.fillStyle = rgba(r.avatar, 0.75 * a);
        dot(left + 18, y + rowH / 2, 4.5);
        ctx.fill();
        if (r.unread) {
          ctx.fillStyle = rgba(BLUE, a);
          dot(left + 7, y + rowH / 2, 2);
          ctx.fill();
        }
        ctx.fillStyle = rgba(INK, (r.unread ? 0.7 : 0.45) * a);
        ctx.fillRect(left + 27, y + 5, inner * r.w1, 3.5);
        ctx.fillStyle = rgba(INK, 0.22 * a);
        ctx.fillRect(left + 27, y + 11, inner * r.w2, 3);
        if (r.replied) {
          ctx.strokeStyle = rgba(BLUE, a);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(W - 8, y + 12);
          ctx.lineTo(W - 14, y + 9);
          ctx.lineTo(W - 8, y + 6);
          ctx.stroke();
        }
      }
      ctx.restore();
    });
  }

  // ── People ──────────────────────────────────────────────────────────────────

  const person = (x, y, yaw, colors, extra = {}) => ({
    x,
    y,
    yaw,
    ...colors,
    sitting: false,
    chair: true,
    phase: 0,
    moving: false,
    reach: null,
    load: [],
    steps: [],
    step: null,
    rest: 0,
    ...extra,
  });
  const look3 = (shirt, skin, hair, pants = 0) => ({
    shirt,
    skin: SKIN[skin],
    hair: HAIR[hair],
    pants: PANTS[pants],
  });
  const secretary = person(-13.2, -5.85, Math.PI / 2, look3(SHIRTS.violet, 1, 0), {
    sitting: true,
  });
  const courier = person(...COURIER_HOME, Math.PI / 2, look3(SHIRTS.amber, 3, 4, 1));
  const you = person(12.9, -4.75, -Math.PI / 2, look3(SHIRTS.navy, 0, 1), { sitting: true });
  const helper = person(7.7, -4.85, -Math.PI / 2, { shirt: BLUE }, { sitting: true, agent: true });
  const others = [
    person(-6.5, -2.4, Math.PI / 2, look3(SHIRTS.sage, 2, 4), { sitting: true, typing: true }),
    person(-4.7, 0.35, -Math.PI / 2, look3(SHIRTS.rose, 0, 2, 2), { sitting: true, typing: true }),
    person(-1.4, -4.35, -Math.PI / 2, look3(SHIRTS.slate, 4, 0), { sitting: true, nodding: true }),
    person(0.8, -4.35, -Math.PI / 2, look3(SHIRTS.sand, 1, 3), { sitting: true }),
    person(3.15, -5.7, Math.PI, look3(SHIRTS.plum, 3, 1, 2), { sitting: true, talking: true }),
    person(3.2, 2.95, Math.PI / 2, look3(SHIRTS.rose, 2, 0), {
      sitting: true,
      chair: false,
      reading: true,
    }),
  ];
  const wanderer = person(-5.2, -6.2, Math.PI / 2, look3(SHIRTS.slate, 0, 2, 1), { sipping: true });
  const people = [secretary, courier, you, helper, wanderer, ...others];

  const facing = (p) => [Math.cos(p.yaw), Math.sin(p.yaw), 0];
  const across = (p) => [-Math.sin(p.yaw), Math.cos(p.yaw), 0];
  const hipOf = (p) =>
    p.sitting
      ? [p.x, p.y, 0.55]
      : [p.x, p.y, 0.88 + (p.moving ? Math.abs(Math.cos(p.phase)) * 0.04 : 0)];
  const swing = (p) => (p.moving ? Math.sin(p.phase) : 0);

  const torsoOf = (p) => (p.sitting ? 0.62 : 0.66);
  const shoulderOf = (p, side) =>
    add(hipOf(p), add(mul(across(p), 0.3 * side), [0, 0, torsoOf(p) - 0.08]));
  /** Which hand reaches for a point: the one on its side. */
  const sideFor = (p, [x, y]) => {
    const s = across(p);
    return (x - p.x) * s[0] + (y - p.y) * s[1] < 0 ? -1 : 1;
  };

  /** Where a hand is (an arm stretches so far, no further). */
  function handOf(p, side) {
    const shoulder = shoulderOf(p, side);
    const d = sub(rawHand(p, side), shoulder);
    return add(shoulder, mul(d, Math.min(1, 0.95 / (Math.hypot(...d) || 1))));
  }

  /** Where a hand wants to be: reaching, carrying, typing, or at rest. */
  function rawHand(p, side) {
    const f = facing(p);
    const s = across(p);
    const hip = hipOf(p);
    const at = (fwd, out, z) => [
      hip[0] + f[0] * fwd + s[0] * out,
      hip[1] + f[1] * fwd + s[1] * out,
      hip[2] + z,
    ];
    const rest = p.sitting
      ? at(0.42, 0.2 * side, 0.32)
      : at(-swing(p) * 0.18 * side, 0.33 * side, 0.05);
    if (p.reach && side === p.reach.side) return mix(rest, p.reach.to, p.reach.k);
    if (p.load.length || p.reading) return at(0.42, 0.17 * side, p.sitting ? 0.62 : 0.4);
    if (p.holding && side === p.holdSide) return at(0.4, 0.12 * side, p.sitting ? 0.66 : 0.5);
    if (p.typing || (p.agent && agent.mail && agent.t < 2.6))
      return at(
        0.55,
        0.17 * side,
        DESK_Z - hip[2] + 0.04 + Math.max(0, Math.sin(now * 13 + side * 1.7)) * 0.04,
      );
    if (p.sipping && side === 1) {
      const sip = clamp(Math.sin(now * 0.8) * 3 - 2, 0, 1);
      return mix(at(0.32, 0.25, 0.45), at(0.22, 0.08, 0.86), sip);
    }
    if (p.talking && side === 1)
      return at(0.45, 0.3, 0.45 + Math.max(0, Math.sin(now * 2.2)) * 0.35);
    return rest;
  }

  function drawPerson(p) {
    const f = facing(p);
    const s = across(p);
    const shirt = p.agent ? AGENT_S : solid(p.shirt);
    const legs = p.agent ? AGENT_S : solid(p.pants);
    const hip = hipOf(p);
    shadow(p.x, p.y, p.sitting ? 0.42 : 0.32);
    if (p.sitting && p.chair) {
      const chair = solid(CHAIR, 0.5);
      cylinder(p.x, p.y, 0, 0.3, 0.05, chair);
      box(p.x - 0.04, p.y - 0.04, 0.05, 0.08, 0.08, 0.38, chair);
      block(
        add([p.x, p.y, 0.43], add(mul(f, -0.3), mul(s, -0.3))),
        mul(f, 0.6),
        mul(s, 0.6),
        [0, 0, 0.08],
        chair,
      );
      // A low mesh back, behind them.
      block(
        add([p.x, p.y, 0.58], add(mul(f, -0.38), mul(s, -0.25))),
        mul(f, 0.06),
        mul(s, 0.5),
        [0, 0, 0.38],
        look(CHAIR, 0.5, 0.42, 0.55, 0.55),
      );
    }
    for (const side of [-1, 1]) {
      const h = add(hip, mul(s, 0.12 * side));
      if (p.sitting) {
        const knee = add(h, mul(f, 0.44));
        limb(h, knee, 0.17, legs);
        limb(knee, [knee[0], knee[1], 0.04], 0.15, legs);
      } else {
        const foot = add([h[0], h[1], 0.04], mul(f, swing(p) * 0.26 * side));
        limb(h, foot, 0.17, legs);
      }
    }
    const torso = torsoOf(p);
    block(
      add(hip, add(mul(s, -0.25), mul(f, -0.14))),
      mul(s, 0.5),
      mul(f, 0.28),
      [0, 0, torso],
      shirt,
    );
    const neck = add(hip, [0, 0, torso]);
    for (const side of [-1, 1]) limb(shoulderOf(p, side), handOf(p, side), 0.12, shirt);
    const nod = p.nodding ? Math.max(0, Math.sin(now * 1.7)) * 0.03 : 0;
    head(neck[0] + f[0] * nod, neck[1] + f[1] * nod, neck[2] + 0.27 - nod, p);
    if (p.reading) {
      const c = handOf(p, 1);
      block(
        [p.x + f[0] * 0.48 - 0.42, p.y + f[1] * 0.48, c[2] - 0.15],
        [0.84, 0, 0],
        [0, 0.02, 0],
        [0, 0, 0.62],
        WHITE_S,
      );
      plane(
        [p.x - 0.36, p.y + f[1] * 0.5 + 0.022, c[2] + 0.42],
        [0.0072, 0, 0],
        [0, 0, -0.0072],
        [100, 70],
        (fo) => {
          ctx.fillStyle = rgba(INK, 0.55 * fo);
          ctx.fillRect(6, 4, 70, 9);
          ctx.fillStyle = rgba(INK, 0.22 * fo);
          for (let i = 0; i < 4; i++) {
            ctx.fillRect(6, 22 + i * 10, 40, 4);
            ctx.fillRect(54, 22 + i * 10, 40, 4);
          }
        },
      );
    }
    if (p.sipping) {
      const c = handOf(p, 1);
      cylinder(c[0], c[1], c[2] - 0.05, 0.08, 0.16, WHITE_S);
    }
  }

  function head(x, y, z, p) {
    const [sx, sy, depth] = project([x, y, z]);
    const toward = Math.cos(p.yaw) * TOWARD[0] + Math.sin(p.yaw) * TOWARD[1];
    later(depth, () => {
      const R = 0.22 * u;
      const f = fog(depth);
      dot(sx, sy, R);
      ctx.fillStyle = rgba(p.agent ? BLUE : p.skin, (p.agent ? 0.35 : 1) * f);
      ctx.fill();
      if (p.hair) {
        // Hair: a ball over the head, further down the back the more it faces away.
        const [bx, by] = vector([-Math.cos(p.yaw), -Math.sin(p.yaw), 0]);
        const away = (1 - toward / 0.82) / 2;
        ctx.save();
        ctx.clip();
        ctx.fillStyle = rgba(p.hair, f);
        dot(sx + (bx / u) * R * 0.35, sy - R * (0.62 - away * 0.9) + (by / u) * R * 0.3, R * 1.02);
        ctx.fill();
        ctx.restore();
        dot(sx, sy, R);
      }
      ctx.strokeStyle = rgba(INK, 0.55 * f);
      ctx.stroke();
      if (p.agent) {
        dot(sx, sy, R * (1.5 + 0.12 * Math.sin(now * 3)));
        ctx.strokeStyle = rgba(BLUE, 0.25 * f);
        ctx.stroke();
      }
    });
  }

  // ── What everyone does: a queue of steps each ───────────────────────────────

  function play(p, steps) {
    p.steps.push(...steps);
  }
  const idle = (p) => !p.step && !p.steps.length && now >= p.rest;

  function stepPerson(p, dt) {
    if (!p.step && p.steps.length) {
      p.step = p.steps.shift();
      p.step.t = 0;
      p.step.start?.(p.step);
    }
    const s = p.step;
    if (!s) return;
    s.t += dt;
    const k = s.dur ? clamp(s.t / s.dur, 0, 1) : 1;
    s.run?.(ease(k), k);
    if (k >= 1) {
      p.step = null;
      s.end?.();
    }
  }

  const pause = (dur, start) => ({ dur, start });
  const turn = (p, yaw, dur = 0.45) => {
    let from = 0;
    return {
      dur,
      start: () => {
        from = p.yaw;
      },
      run: (e) => {
        p.yaw = turnTo(from, typeof yaw === "function" ? yaw() : yaw, e);
      },
    };
  };
  const reach = (p, to, dur, end) => ({
    dur,
    start: () => {
      const at = typeof to === "function" ? to() : to;
      p.reach = { to: at, k: 0, side: sideFor(p, at) };
    },
    run: (e) => {
      p.reach.k = e;
    },
    end,
  });
  const retract = (p, dur = 0.25) => ({
    dur,
    run: (e) => {
      if (p.reach) p.reach.k = 1 - e;
    },
    end: () => {
      p.reach = null;
    },
  });
  const facingTo =
    (p, [x, y]) =>
    () =>
      Math.atan2(y - p.y, x - p.x);

  function walk(p, points, speed = p === courier ? 3.2 : 2.2) {
    let legs = [];
    let total = 0;
    return {
      dur: 0,
      start: (step) => {
        legs = [];
        total = 0;
        let from = [p.x, p.y];
        for (const to of points) {
          const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
          if (len > 0.01) legs.push({ from, to, len, at: total });
          total += len;
          from = to;
        }
        step.dur = total / speed;
        p.moving = true;
      },
      run: (_, k) => {
        const d = k * total;
        const leg = legs.findLast((l) => l.at <= d);
        if (!leg) return;
        const t = clamp((d - leg.at) / leg.len, 0, 1);
        p.x = lerp(leg.from[0], leg.to[0], t);
        p.y = lerp(leg.from[1], leg.to[1], t);
        p.yaw = turnTo(p.yaw, Math.atan2(leg.to[1] - leg.from[1], leg.to[0] - leg.from[0]), 0.3);
        p.phase = d * 3;
      },
      end: () => {
        p.moving = false;
      },
    };
  }

  // ── The mail ────────────────────────────────────────────────────────────────

  let mails = [];
  let rows = [];
  let timers = [];
  let now = 0;
  let nextMail = 0;
  let fromGmail = true;
  let nextId = 1;
  let ding = -9;
  let shredded = -9;
  let notified = -9;
  let drawer = 0;
  let drawerOpen = false;
  let passing = false;
  const keys = [];
  const basket = [];
  const toYou = [];
  const inbox = [];
  const outbox = [];
  const holes = { northwind: 2, hiring: 1, finance: 3 };
  const agent = { mail: null, t: 0, reply: null };

  const after = (delay, fn) => timers.push({ at: now + delay, fn });
  const press = (p, text) => keys.push({ p, text, at: now });
  const row = (id, avatar, unread) => ({
    id,
    avatar,
    unread,
    w1: 0.35 + random() * 0.25,
    w2: 0.55 + random() * 0.35,
    y: -1,
    a: 0,
  });
  // What's already in the inbox, read.
  for (let i = 0; i < 8; i++)
    rows.push({ ...row(-i, AVATARS[i % AVATARS.length], false), y: i, a: 1 });
  const rowOf = (m) => rows.find((r) => r.id === m.id);

  function hold(p, m) {
    m.state = "held";
    m.holder = p;
    p.holding = m;
    p.holdSide = p.reach?.side ?? 1;
  }
  function letGo(m) {
    if (m.holder?.holding === m) m.holder.holding = null;
    m.holder = null;
  }
  function fly(m, to, { peak = 0.5, dur = 0.7, yaw = 0, land }) {
    letGo(m);
    Object.assign(m, {
      state: "fly",
      from: [m.x, m.y, m.z],
      to,
      peak,
      dur,
      t: 0,
      yaw0: m.yaw,
      yaw1: yaw,
      land,
    });
  }
  /** Lays a letter on a pile, and settles the pile (on a tray `z` high). */
  const restOn = (m, list, z) => {
    letGo(m);
    m.state = "rest";
    m.yaw = (random() - 0.5) * 0.3;
    list.push(m);
    if (z !== undefined) settle(list, z);
  };
  const settle = (list, z) => {
    for (const [i, m] of list.entries()) m.z = z + 0.16 + i * 0.055;
  };

  function spawn() {
    const roll = random();
    const kind =
      roll < 0.52
        ? "inbox"
        : roll < 0.64
          ? "northwind"
          : roll < 0.75
            ? "hiring"
            : roll < 0.86
              ? "finance"
              : "junk";
    const x = fromGmail ? SLOTS.gmail : SLOTS.imap;
    fromGmail = !fromGmail;
    const m = {
      id: nextId++,
      kind,
      x,
      y: WALL_Y + 0.3,
      z: SLOT_Z + 0.1,
      yaw: 0,
      alpha: 1,
      avatar: AVATARS[Math.floor(random() * AVATARS.length)],
    };
    mails.push(m);
    ding = now;
    fly(
      m,
      () => [BASKET[0] + (random() - 0.5) * 0.3, BASKET[1], BASKET[2] + 0.1 + basket.length * 0.05],
      {
        peak: 0.3,
        dur: 0.75,
        yaw: (random() - 0.5) * 0.4,
        land: () => {
          basket.push(m);
          m.state = "rest";
        },
      },
    );
  }

  function update(dt) {
    now += dt;
    for (const timer of timers.filter((tm) => tm.at <= now)) timer.fn();
    timers = timers.filter((tm) => tm.at > now);

    if (now >= nextMail) {
      spawn();
      nextMail = now + 2.4 + random() * 0.8;
    }

    for (const m of mails) {
      if (m.state === "fly") {
        m.t += dt / m.dur;
        const k = clamp(m.t, 0, 1);
        if (typeof m.to === "function") m.to = m.to();
        [m.x, m.y, m.z] = mix(m.from, m.to, ease(k));
        m.z += Math.sin(Math.PI * k) * m.peak;
        m.yaw = lerp(m.yaw0, m.yaw1, k);
        if (k >= 1) {
          m.state = "rest";
          const land = m.land;
          m.land = null;
          land?.();
        }
      } else if (m.state === "held") {
        const p = m.holder;
        const h = handOf(p, p.load.length ? 1 : p.holdSide);
        const i = p.load.indexOf(m);
        const k = 1 - Math.exp(-dt * 18);
        [m.x, m.y, m.z] = mix([m.x, m.y, m.z], add(h, [0, 0, 0.03 + Math.max(0, i) * 0.06]), k);
        m.yaw = turnTo(m.yaw, p.yaw + Math.PI / 2, k);
      } else if (m.state === "fade") {
        letGo(m);
        m.alpha -= dt * 2.5;
        m.z += dt * (m.rise ?? -0.3);
        if (m.alpha <= 0) m.gone = true;
      }
    }
    mails = mails.filter((m) => !m.gone);

    if (idle(secretary) && basket.length) sortNext();
    if (idle(courier) && toYou.length) deliver();
    if (idle(you)) work();
    you.typing = !you.step && !you.steps.length;
    if (idle(wanderer)) wander();
    for (const p of people) stepPerson(p, dt);

    drawer = clamp(drawer + (drawerOpen ? dt : -dt) * 2.6, 0, 1);

    // The inbox every screen shows eases into place.
    let slot = 0;
    for (const r of rows) {
      if (r.gone) r.a = Math.max(0, r.a - dt * 3);
      else {
        r.a = Math.min(1, r.a + dt * 2.5);
        r.slot = slot++;
      }
      r.y = lerp(r.y, r.slot ?? r.y, 1 - Math.exp(-dt * 7));
    }
    rows = rows.filter((r) => !(r.gone && r.a <= 0)).slice(0, 12);

    // The agent drafts a reply, then tosses it to your outbox.
    if (agent.mail) {
      agent.t += dt;
      if (agent.t >= 2.6 && !agent.reply) {
        const m = agent.mail;
        agent.reply = {
          id: nextId++,
          kind: "reply",
          x: m.x,
          y: m.y,
          z: m.z,
          yaw: m.yaw,
          alpha: 1,
          state: "rest",
        };
        mails.push(agent.reply);
        Object.assign(m, { state: "fade", rise: 0.4 });
      }
      if (agent.t >= 3.1 && agent.reply?.state === "rest") {
        const r = agent.reply;
        fly(r, () => trayTop(OUTBOX, DESK_Z, outbox), {
          peak: 1.3,
          dur: 0.9,
          land: () => {
            restOn(r, outbox, DESK_Z);
            Object.assign(agent, { mail: null, reply: null, t: 0 });
          },
        });
      }
    }
  }

  /** The receptionist: turn, take the next letter, read it, send it on. */
  function sortNext() {
    const p = secretary;
    const m = basket.at(-1);
    play(p, [
      turn(p, facingTo(p, BASKET), 0.35),
      reach(
        p,
        () => [m.x, m.y, m.z + 0.08],
        0.3,
        () => {
          basket.splice(basket.indexOf(m), 1);
          hold(p, m);
        },
      ),
      retract(p),
      turn(p, Math.PI / 2, 0.35),
      pause(0.35),
    ]);
    if (m.kind === "inbox") {
      // The counter is out of reach: she slides it the rest of the way.
      play(p, [
        reach(
          p,
          () => trayTop(TO_YOU, LEDGE + 0.06, toYou),
          0.3,
          () => {
            fly(m, () => trayTop(TO_YOU, LEDGE + 0.06, toYou), {
              peak: 0.25,
              dur: 0.4,
              land: () => restOn(m, toYou, LEDGE + 0.06),
            });
          },
        ),
        retract(p),
      ]);
    } else {
      const target =
        m.kind === "junk"
          ? [SHREDDER[0], SHREDDER[1], 1.05]
          : [
              HOLES.x + (COLUMNS.indexOf(m.kind) + 0.5) * HOLES.w + 0.05,
              HOLES.y + 0.75,
              HOLES.z + HOLES.h * 3.5,
            ];
      play(p, [
        turn(p, facingTo(p, target), 0.35),
        reach(
          p,
          () => add(shoulderOf(p, sideFor(p, target)), mul(unit(sub(target, [p.x, p.y, 1])), 0.7)),
          0.15,
          () => {
            fly(m, target, {
              peak: m.kind === "junk" ? 0.5 : 0.9,
              dur: m.kind === "junk" ? 0.55 : 0.7,
              yaw: m.kind === "junk" ? 0 : Math.PI / 2,
              land: () => {
                if (m.kind === "junk") shredded = now;
                else holes[m.kind] = Math.min(4, holes[m.kind] + 1);
                m.gone = true;
              },
            });
          },
        ),
        retract(p, 0.2),
        turn(p, Math.PI / 2, 0.35),
      ]);
    }
    play(p, [pause(0.15)]);
  }

  /** The courier: take what's for you to your desk, bring replies back to post. */
  function deliver() {
    const p = courier;
    play(p, [
      walk(p, [PICKUP]),
      turn(p, -Math.PI / 2, 0.3),
      reach(
        p,
        () => trayTop(TO_YOU, LEDGE + 0.06, toYou),
        0.3,
        () => {
          p.load = toYou.splice(0);
          for (const m of p.load) hold(p, m);
        },
      ),
      retract(p),
      walk(p, [
        [PICKUP[0], AISLE],
        [DOOR_X, AISLE],
        [DOOR_X, OFFICE.y - 1],
        [INBOX_STOP[0] - 0.2, BEHIND],
        INBOX_STOP,
      ]),
      turn(p, facingTo(p, INBOX), 0.3),
      reach(
        p,
        () => trayTop(INBOX, DESK_Z, inbox),
        0.35,
        () => {
          p.load.forEach((m, i) => {
            fly(m, [INBOX[0], INBOX[1], DESK_Z + 0.16 + (inbox.length + i) * 0.055], {
              peak: 0.15,
              dur: 0.25 + i * 0.08,
              land: () => restOn(m, inbox, DESK_Z),
            });
            rows.unshift(row(m.id, m.avatar, true));
          });
          p.load = [];
          notified = now;
        },
      ),
      retract(p),
      pause(0.01, () => collect()),
    ]);
  }

  function collect() {
    const p = courier;
    const sent = outbox.filter((m) => m.approved);
    const home = [
      [DOOR_X, OFFICE.y - 1],
      [DOOR_X, AISLE],
    ];
    if (!sent.length) {
      play(p, [
        walk(p, [[INBOX_STOP[0] - 0.2, BEHIND], ...home, [COURIER_HOME[0], AISLE], COURIER_HOME]),
        turn(p, Math.PI / 2),
        pause(1.5),
      ]);
      return;
    }
    play(p, [
      walk(p, [[INBOX_STOP[0], BEHIND], [OUTBOX_STOP[0], BEHIND], OUTBOX_STOP]),
      turn(p, facingTo(p, OUTBOX), 0.3),
      reach(
        p,
        () => [OUTBOX[0], OUTBOX[1], DESK_Z + 0.2],
        0.3,
        () => {
          p.load = outbox.filter((m) => m.approved);
          for (const m of p.load) {
            outbox.splice(outbox.indexOf(m), 1);
            hold(p, m);
          }
          settle(outbox, DESK_Z);
        },
      ),
      retract(p),
      walk(p, [
        [OUTBOX_STOP[0], BEHIND],
        [INBOX_STOP[0], BEHIND],
        ...home,
        [POSTBOX[0] + 1.1, AISLE],
        [POSTBOX[0] + 1.1, POSTBOX[1]],
      ]),
      turn(p, Math.PI, 0.3),
      reach(p, [POSTBOX[0] + 0.3, POSTBOX[1], 1.08], 0.35, () => {
        for (const m of p.load) Object.assign(m, { state: "fade", rise: 1.2, yaw: 0 });
        p.load = [];
      }),
      retract(p),
      walk(p, [[POSTBOX[0] + 1.1, AISLE], [COURIER_HOME[0], AISLE], COURIER_HOME]),
      turn(p, Math.PI / 2),
      pause(1.5),
    ]);
  }

  /** A colleague with a coffee, off to chat on the sofa and back. */
  function wander() {
    const p = wanderer;
    const coffee = [-5.2, -6.2];
    // Out past the meeting room, not through it.
    const way = [
      [-5.2, -3],
      [-2.7, -3],
      [-2.7, AISLE],
      [6.3, AISLE],
      [6.3, 4.3],
    ];
    play(p, [
      walk(p, way),
      turn(p, facingTo(p, [3.2, 2.95]), 0.5),
      pause(4.5, () => {
        p.nodding = true;
      }),
      pause(0.01, () => {
        p.nodding = false;
      }),
      walk(p, [way[3], way[2], way[1], way[0], coffee]),
      turn(p, Math.PI / 2, 0.5),
      pause(5),
    ]);
  }

  /** You: send a reply the agent wrote, or read the next letter and decide. */
  function work() {
    const p = you;
    const draft = outbox.find((m) => !m.approved);
    if (draft) {
      press(p, "⌘↩");
      play(p, [
        reach(
          p,
          () => [OUTBOX[0] - 0.2, OUTBOX[1], DESK_Z + 0.3],
          0.3,
          () => {
            draft.approved = true;
          },
        ),
        retract(p),
        pause(0.4),
      ]);
      return;
    }
    if (!inbox.length) return;
    const m = inbox.at(-1);
    play(p, [
      reach(
        p,
        () => [m.x, m.y, m.z + 0.08],
        0.35,
        () => {
          inbox.splice(inbox.indexOf(m), 1);
          settle(inbox, DESK_Z);
          hold(p, m);
          press(p, "J");
          const r = rowOf(m);
          if (r) Object.assign(r, { unread: false, active: true });
        },
      ),
      retract(p, 0.3),
      pause(1.1, () => {
        m.open = true;
      }),
      pause(0.01, () => decide(m)),
    ]);
  }

  function decide(m) {
    const p = you;
    const r = rowOf(m);
    // Every other letter goes to the agent, when it's free.
    passing = !passing;
    if (passing && !agent.mail) {
      play(p, [
        turn(p, facingTo(p, AGENT_TRAY), 0.45),
        reach(
          p,
          () =>
            add(
              shoulderOf(p, sideFor(p, AGENT_TRAY)),
              mul(unit(sub([...AGENT_TRAY, 1], [p.x, p.y, 1])), 0.7),
            ),
          0.15,
          () => {
            press(p, "R");
            if (r) Object.assign(r, { active: false, replied: true });
            agent.mail = m;
            agent.t = -1;
            fly(m, () => trayTop(AGENT_TRAY, DESK_Z, []), {
              peak: 1.3,
              dur: 0.9,
              land: () => {
                m.state = "rest";
                agent.t = 0;
              },
            });
          },
        ),
        retract(p, 0.2),
        turn(p, -Math.PI / 2, 0.45),
        pause(0.5),
      ]);
    } else {
      play(p, [
        pause(0.01, () => {
          press(p, "E");
          drawerOpen = true;
        }),
        turn(p, -0.35, 0.4),
        reach(
          p,
          () => add(shoulderOf(p, 1), [0.45, -0.3, 0.2]),
          0.15,
          () => {
            fly(m, [CABINET.x + 0.75, CABINET.y + 1.25 + 0.7, 1.75], {
              peak: 0.6,
              dur: 0.55,
              land: () => {
                Object.assign(m, { state: "fade", rise: -0.6 });
                if (r) r.gone = true;
                after(0.35, () => {
                  drawerOpen = false;
                });
              },
            });
          },
        ),
        retract(p, 0.2),
        turn(p, -Math.PI / 2, 0.4),
        pause(0.4),
      ]);
    }
  }

  function envelope(m) {
    if (m.alpha <= 0) return;
    const a = [Math.cos(m.yaw) * 0.7, Math.sin(m.yaw) * 0.7, 0];
    const b = [-Math.sin(m.yaw) * 0.48, Math.cos(m.yaw) * 0.48, 0];
    const o = [m.x - a[0] / 2 - b[0] / 2, m.y - a[1] / 2 - b[1] / 2, m.z];
    block(o, a, b, [0, 0, 0.035], m.kind === "junk" ? JUNK_S : WHITE_S, { alpha: m.alpha });
    plane(add(o, [0, 0, 0.035]), mul(a, 0.01), mul(b, 1 / 68), [100, 68], (f) => {
      const alpha = m.alpha * f;
      ctx.lineWidth = 3;
      ctx.strokeStyle = rgba(INK, 0.45 * alpha);
      ctx.beginPath();
      ctx.moveTo(4, 4);
      ctx.lineTo(50, 40);
      ctx.lineTo(96, 4);
      ctx.stroke();
      const rgb = LABELS[m.kind] ?? (m.kind === "reply" ? BLUE : null);
      if (rgb) {
        ctx.fillStyle = rgba(rgb, 0.9 * alpha);
        ctx.fillRect(74, 46, 16, 14);
      }
      if (m.approved) {
        ctx.strokeStyle = rgba(LABELS.finance, alpha);
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(12, 50);
        ctx.lineTo(20, 58);
        ctx.lineTo(34, 42);
        ctx.stroke();
      }
    });
  }

  // ── Running it ──────────────────────────────────────────────────────────────

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    queue = [];
    room(now);
    for (const p of people) drawPerson(p);
    for (const m of mails) envelope(m);
    for (const k of keys) keycap(k.p, k.text, now - k.at);
    queue.sort((p, q) => p.depth - q.depth);
    ctx.lineWidth = px;
    ctx.lineJoin = "round";
    for (const item of queue) item.draw();
  }

  function resize() {
    px = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.round(w * px);
    canvas.height = Math.round(h * px);
    u = Math.max(w / 37, 18) * px;
    // The middle of the office, a little below the middle of the canvas.
    ox = 0;
    oy = 0;
    const [fx, fy] = project([0.4, -2.4, 1.2]);
    ox = canvas.width / 2 - fx;
    oy = canvas.height * 0.52 - fy;
    draw();
  }

  // Start with the office already busy.
  for (let i = 0; i < 40 * 30; i++) update(1 / 30);
  keys.length = 0;

  let playing = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let visible = true;
  let last = 0;
  let frame = 0;

  function tick(time) {
    frame = 0;
    update(last ? Math.min(0.05, (time - last) / 1000) : 0);
    last = time;
    for (let i = keys.length - 1; i >= 0; i--) if (now - keys[i].at > 1.5) keys.splice(i, 1);
    draw();
    schedule();
  }
  function schedule() {
    if (!playing || !visible || document.hidden) last = 0;
    else if (!frame) frame = requestAnimationFrame(tick);
  }
  function setPlaying(next) {
    playing = next;
    toggle.textContent = playing ? "Pause" : "Play";
    toggle.setAttribute("aria-pressed", String(!playing));
    if (!playing && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    schedule();
  }

  toggle.addEventListener("click", () => setPlaying(!playing));
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    schedule();
  }).observe(canvas);
  document.addEventListener("visibilitychange", schedule);
  new ResizeObserver(resize).observe(canvas);
  resize();
  setPlaying(playing);
})();
