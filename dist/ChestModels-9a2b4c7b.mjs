import * as f from "three";
const P = {
  single: [
    // base
    {
      from: [1, 0, 1],
      to: [15, 10, 15],
      faces: {
        down: { uv: [7, 8.25, 3.5, 4.75] },
        north: { uv: [14, 10.75, 10.5, 8.25] },
        south: { uv: [7, 10.75, 3.5, 8.25] },
        east: { uv: [3.5, 10.75, 0, 8.25] },
        west: { uv: [10.5, 10.75, 7, 8.25] }
      }
    },
    // lid (viewer lid y 10..14; vanilla 9..14 — visible top 4 px of the side strips)
    {
      from: [1, 10, 1],
      to: [15, 14, 15],
      faces: {
        up: { uv: [10.5, 0, 7, 3.5] },
        north: { uv: [14, 4.75, 10.5, 3.75] },
        south: { uv: [7, 4.75, 3.5, 3.75] },
        east: { uv: [3.5, 4.75, 0, 3.75] },
        west: { uv: [10.5, 4.75, 7, 3.75] }
      }
    },
    // latch
    {
      from: [7, 7, 0],
      to: [9, 11, 1],
      faces: {
        up: { uv: [1.25, 0, 0.75, 0.25] },
        down: { uv: [0.75, 0.25, 0.25, 0] },
        north: { uv: [1.5, 1.25, 1, 0.25] },
        east: { uv: [0.25, 1.25, 0, 0.25] },
        west: { uv: [1, 1.25, 0.75, 0.25] }
      }
    }
  ],
  // LEFT: on the WEST at facing=north; fills to x=16 (shared boundary = its +X edge).
  left: [
    {
      from: [1, 0, 1],
      to: [16, 10, 15],
      faces: {
        down: { uv: [7.25, 8.25, 3.5, 4.75] },
        north: { uv: [14.5, 10.75, 10.75, 8.25] },
        south: { uv: [7.25, 10.75, 3.5, 8.25] },
        west: { uv: [10.75, 10.75, 7.25, 8.25] }
      }
    },
    {
      from: [1, 10, 1],
      to: [16, 14, 15],
      faces: {
        up: { uv: [11, 0, 7.25, 3.5] },
        north: { uv: [14.5, 4.75, 10.75, 3.75] },
        south: { uv: [7.25, 4.75, 3.5, 3.75] },
        west: { uv: [10.75, 4.75, 7.25, 3.75] }
      }
    },
    {
      from: [15, 7, 0],
      to: [16, 11, 1],
      faces: {
        up: { uv: [0.75, 0, 0.5, 0.25] },
        down: { uv: [0.5, 0.25, 0.25, 0] },
        north: { uv: [1, 1.25, 0.75, 0.25] },
        west: { uv: [0.75, 1.25, 0.5, 0.25] }
      }
    }
  ],
  // RIGHT: on the EAST at facing=north; starts at x=0 (shared boundary = its -X edge).
  right: [
    {
      from: [0, 0, 1],
      to: [15, 10, 15],
      faces: {
        down: { uv: [7.25, 8.25, 3.5, 4.75] },
        north: { uv: [14.5, 10.75, 10.75, 8.25] },
        south: { uv: [7.25, 10.75, 3.5, 8.25] },
        east: { uv: [3.5, 10.75, 0, 8.25] }
      }
    },
    {
      from: [0, 10, 1],
      to: [15, 14, 15],
      faces: {
        up: { uv: [11, 0, 7.25, 3.5] },
        north: { uv: [14.5, 4.75, 10.75, 3.75] },
        south: { uv: [7.25, 4.75, 3.5, 3.75] },
        east: { uv: [3.5, 4.75, 0, 3.75] }
      }
    },
    {
      from: [0, 7, 0],
      to: [1, 11, 1],
      faces: {
        up: { uv: [0.75, 0, 0.5, 0.25] },
        down: { uv: [0.5, 0.25, 0.25, 0] },
        north: { uv: [1, 1.25, 0.75, 0.25] },
        east: { uv: [0.25, 1.25, 0, 0.25] }
      }
    }
  ]
}, H = ["down", "up", "north", "south", "west", "east"], R = {
  down: [0, -1, 0],
  up: [0, 1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0]
};
function U(t, c, e) {
  const [r, n, s] = c, [o, i, l] = e;
  switch (t) {
    case "north":
      return [
        [o, i, s],
        [r, i, s],
        [r, n, s],
        [o, n, s]
      ];
    case "south":
      return [
        [r, i, l],
        [o, i, l],
        [o, n, l],
        [r, n, l]
      ];
    case "east":
      return [
        [o, i, l],
        [o, i, s],
        [o, n, s],
        [o, n, l]
      ];
    case "west":
      return [
        [r, i, s],
        [r, i, l],
        [r, n, l],
        [r, n, s]
      ];
    case "up":
      return [
        [r, i, s],
        [o, i, s],
        [o, i, l],
        [r, i, l]
      ];
    case "down":
      return [
        [r, n, l],
        [o, n, l],
        [o, n, s],
        [r, n, s]
      ];
  }
}
function A(t) {
  const c = P[t], e = [], r = [], n = [], s = [];
  for (const i of c) {
    const l = [i.from[0] / 16, i.from[1] / 16, i.from[2] / 16], C = [i.to[0] / 16, i.to[1] / 16, i.to[2] / 16];
    for (const w of H) {
      const y = i.faces[w];
      if (!y)
        continue;
      const S = U(w, l, C), M = R[w], [b, T, u, h] = y.uv, x = [
        [b, T],
        [u, T],
        [u, h],
        [b, h]
      ], v = (y.rotation ?? 0) / 90 | 0, p = e.length / 3;
      for (let d = 0; d < 4; d++) {
        const a = S[d];
        e.push(a[0], a[1], a[2]), r.push(M[0], M[1], M[2]);
        const [g, m] = x[(d - v + 4) % 4];
        n.push(g / 16, 1 - m / 16);
      }
      s.push(p, p + 3, p + 2, p, p + 2, p + 1);
    }
  }
  const o = new f.BufferGeometry();
  return o.setAttribute("position", new f.Float32BufferAttribute(e, 3)), o.setAttribute("normal", new f.Float32BufferAttribute(r, 3)), o.setAttribute("uv", new f.Float32BufferAttribute(n, 2)), o.setIndex(s), o.computeBoundingBox(), o.computeBoundingSphere(), o;
}
const _ = {
  north: 0,
  east: -Math.PI / 2,
  south: Math.PI,
  west: Math.PI / 2
};
function k(t, c) {
  if (t === "ender")
    return "entity/chest/ender";
  const e = `entity/chest/${t}`;
  return c === "single" ? e : `${e}_${c}`;
}
function B(t, c) {
  const e = c.get(t);
  if (e)
    return e;
  t.magFilter = f.NearestFilter, t.minFilter = f.NearestFilter, t.generateMipmaps = !1, t.needsUpdate = !0;
  const r = new f.MeshStandardMaterial({ map: t, roughness: 1, metalness: 0 });
  return c.set(t, r), r;
}
function q(t) {
  if (typeof t == "string") {
    const c = t.indexOf("[");
    return (c >= 0 ? t.slice(0, c) : t).trim();
  }
  if (t && typeof t == "object") {
    const c = t, e = c.name ?? c.Name;
    if (typeof e == "string")
      return e;
  }
  return "";
}
function $(t, c) {
  if (typeof t == "string") {
    const e = t.indexOf("["), r = t.lastIndexOf("]");
    if (e < 0 || r <= e)
      return;
    for (const n of t.slice(e + 1, r).split(",")) {
      const s = n.indexOf("=");
      if (!(s < 0) && n.slice(0, s).trim() === c)
        return n.slice(s + 1).trim();
    }
    return;
  }
  if (t && typeof t == "object") {
    const e = t, r = e.properties ?? e.Properties, n = r == null ? void 0 : r[c];
    return n == null ? void 0 : String(n);
  }
}
function E(t) {
  const c = typeof t.chest == "string" ? t.chest : "", e = `${q(t.state)} ${c}`.toLowerCase();
  return e.includes("ender_chest") || c === "ender" ? "ender" : e.includes("trapped_chest") || c === "trapped" ? "trapped" : e.includes("copper_chest") ? e.includes("oxidized") ? "copper_oxidized" : e.includes("weathered") ? "copper_weathered" : e.includes("exposed") ? "copper_exposed" : "copper" : e.includes("chest") || c === "normal" || t.chest === !0 ? "normal" : null;
}
function I(t) {
  return t === "east" || t === "south" || t === "west" ? t : "north";
}
function D(t) {
  return t === "left" || t === "right" ? t : "single";
}
function z(t, c) {
  const e = t.length;
  if (e === 0)
    return;
  if (typeof t[0] == "number") {
    const n = t;
    for (let s = 0; s + 2 < e; s += 3)
      c(n[s], n[s + 1], n[s + 2]);
    return;
  }
  for (let n = 0; n < e; n++) {
    const s = t[n];
    if ("x" in s) {
      const o = s;
      c(o.x, o.y, o.z);
    } else {
      const o = s;
      c(o[0], o[1], o[2]);
    }
  }
}
async function G(t, c) {
  const e = E({ state: t });
  if (!e)
    return null;
  const r = e === "ender" ? "single" : D($(t, "type")), n = I($(t, "facing")), s = await c.getTexture(k(e, r)), o = A(r);
  o.translate(-0.5, -0.5, -0.5), o.rotateY(_[n]);
  const i = new f.Mesh(o, B(s, /* @__PURE__ */ new Map()));
  return i.name = `chest:${e}:${n}:${r}`, i;
}
async function L(t, c, e, r, n) {
  const s = /* @__PURE__ */ new Map(), o = [];
  for (const u of t) {
    const h = E(u);
    if (!h) {
      o.push(u);
      continue;
    }
    const x = I($(u.state, "facing") ?? u.facing), v = h === "ender" ? "single" : D($(u.state, "type")), p = `${h}|${x}|${v}`;
    let d = s.get(p);
    d || (d = { kind: h, facing: x, type: v, state: u.state, cells: [] }, s.set(p, d));
    const a = d.cells;
    z(u.positions, (g, m, F) => {
      a.push(g, m, F);
    });
  }
  const i = /* @__PURE__ */ new Map(), l = new f.Sphere(
    new f.Vector3(e / 2, r / 2, n / 2),
    0.5 * Math.sqrt(e * e + r * r + n * n) + 1
  ), C = [], w = new f.Matrix4(), y = new f.Matrix4(), S = new f.Matrix4(), M = new f.Matrix4(), b = new f.Matrix4(), T = new f.Matrix4();
  for (const u of s.values()) {
    const h = u.cells.length / 3;
    if (h === 0)
      continue;
    const x = A(u.type), v = await c.getTexture(k(u.kind, u.type)), p = v && v.isTexture ? v : null;
    if (!p) {
      console.warn(
        `[ChestModels] texture unavailable for ${u.kind}/${u.type}, skipping ${h} cells`
      );
      continue;
    }
    const d = B(p, i);
    w.makeTranslation(0.5, 0, 0.5), y.makeRotationY(_[u.facing]), S.makeTranslation(-0.5, 0, -0.5), M.multiplyMatrices(w, y).multiply(S);
    const a = new f.InstancedMesh(x, d, h);
    a.instanceMatrix.setUsage(f.StaticDrawUsage);
    for (let m = 0; m < h; m++) {
      const F = u.cells[m * 3], N = u.cells[m * 3 + 1], O = u.cells[m * 3 + 2];
      b.makeTranslation(F - 0.5, N - 0.5, O - 0.5), T.multiplyMatrices(b, M), a.setMatrixAt(m, T);
    }
    a.instanceMatrix.needsUpdate = !0, a.computeBoundingBox(), a.computeBoundingSphere();
    const g = a.boundingSphere;
    (!g || !Number.isFinite(g.radius) || g.radius <= 0 || !Number.isFinite(g.center.x)) && (a.boundingSphere = l.clone()), a.name = `chest:${u.kind}:${u.facing}:${u.type}`, a.userData.chestBypass = !0, a.userData.entityBypass = !0, a.userData.blockState = u.state, a.userData.chestKind = u.kind, a.userData.chestFacing = u.facing, a.userData.chestType = u.type, a.userData.cells = Int32Array.from(u.cells), C.push(a);
  }
  return { meshes: C, rest: o };
}
export {
  _ as CHEST_FACING_THETA,
  G as buildChestBlockMesh,
  L as buildChestInstancedMeshes,
  A as chestModelGeo,
  k as chestTexturePath
};
