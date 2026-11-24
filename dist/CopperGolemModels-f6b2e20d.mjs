import * as e from "three";
import { m as C } from "./index-5a2c120d.mjs";
import "nucleation";
const H = [
  {
    name: "body",
    parent: -1,
    offset: [
      0,
      -5,
      0
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: [
      {
        uv: [
          0,
          15
        ],
        box: [
          -4,
          -6,
          -3,
          8,
          6,
          6
        ],
        inflate: 0
      }
    ]
  },
  {
    name: "head",
    parent: 0,
    offset: [
      0,
      -6,
      0
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: [
      {
        uv: [
          0,
          0
        ],
        box: [
          -4,
          -5,
          -5,
          8,
          5,
          10
        ],
        inflate: 0.015
      },
      {
        uv: [
          56,
          0
        ],
        box: [
          -1,
          -2,
          -6,
          2,
          3,
          2
        ],
        inflate: 0
      },
      {
        uv: [
          37,
          8
        ],
        box: [
          -1,
          -9,
          -1,
          2,
          4,
          2
        ],
        inflate: -0.015
      },
      {
        uv: [
          37,
          0
        ],
        box: [
          -2,
          -13,
          -2,
          4,
          4,
          4
        ],
        inflate: -0.015
      }
    ]
  },
  {
    name: "right_arm",
    parent: 0,
    offset: [
      -4,
      -6,
      0
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: [
      {
        uv: [
          36,
          16
        ],
        box: [
          -3,
          -1,
          -2,
          3,
          10,
          4
        ],
        inflate: 0
      }
    ]
  },
  {
    name: "left_arm",
    parent: 0,
    offset: [
      4,
      -6,
      0
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: [
      {
        uv: [
          50,
          16
        ],
        box: [
          0,
          -1,
          -2,
          3,
          10,
          4
        ],
        inflate: 0
      }
    ]
  },
  {
    name: "right_leg",
    parent: -1,
    offset: [
      0,
      -5,
      0
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: [
      {
        uv: [
          0,
          27
        ],
        box: [
          -4,
          0,
          -2,
          4,
          5,
          4
        ],
        inflate: 0
      }
    ]
  },
  {
    name: "left_leg",
    parent: -1,
    offset: [
      0,
      -5,
      0
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: [
      {
        uv: [
          16,
          27
        ],
        box: [
          0,
          0,
          -2,
          4,
          5,
          4
        ],
        inflate: 0
      }
    ]
  }
], O = [
  {
    name: "body",
    parent: -1,
    offset: [
      -1.064,
      -5,
      0
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: []
  },
  {
    name: "body_r1",
    parent: 0,
    offset: [
      1.1,
      0.1,
      0.7
    ],
    rotation: [
      0.1204,
      -64e-4,
      -0.0779
    ],
    cubes: [
      {
        uv: [
          0,
          15
        ],
        box: [
          -4.02,
          -6.116,
          -3.5,
          8,
          6,
          6
        ],
        inflate: 0
      }
    ]
  },
  {
    name: "head",
    parent: 0,
    offset: [
      0.7,
      -5.6,
      -1.8
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: [
      {
        uv: [
          0,
          0
        ],
        box: [
          -4,
          -5.1,
          -5,
          8,
          5,
          10
        ],
        inflate: 0
      },
      {
        uv: [
          56,
          0
        ],
        box: [
          -1.02,
          -2.1,
          -6,
          2,
          3,
          2
        ],
        inflate: 0
      },
      {
        uv: [
          37,
          8
        ],
        box: [
          -1.02,
          -9.1,
          -1,
          2,
          4,
          2
        ],
        inflate: -0.015
      },
      {
        uv: [
          37,
          0
        ],
        box: [
          -2,
          -13.1,
          -2,
          4,
          4,
          4
        ],
        inflate: -0.015
      }
    ]
  },
  {
    name: "right_arm",
    parent: 0,
    offset: [
      -4,
      -6,
      0
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: []
  },
  {
    name: "right_arm_r1",
    parent: 3,
    offset: [
      0.7,
      -0.248,
      -1.62
    ],
    rotation: [
      1.0036,
      0,
      0
    ],
    cubes: [
      {
        uv: [
          36,
          16
        ],
        box: [
          -3.052,
          -1.11,
          -2.036,
          3,
          10,
          4
        ],
        inflate: 0
      }
    ]
  },
  {
    name: "left_arm",
    parent: 0,
    offset: [
      4,
      -6,
      0
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: []
  },
  {
    name: "left_arm_r1",
    parent: 5,
    offset: [
      0.732,
      0,
      0
    ],
    rotation: [
      -0.8715,
      -0.0535,
      -0.0449
    ],
    cubes: [
      {
        uv: [
          50,
          16
        ],
        box: [
          0.032,
          -1.1,
          -2,
          3,
          10,
          4
        ],
        inflate: 0
      }
    ]
  },
  {
    name: "right_leg",
    parent: -1,
    offset: [
      -3.064,
      -5,
      0
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: []
  },
  {
    name: "right_leg_r1",
    parent: 7,
    offset: [
      1.048,
      0,
      -0.9
    ],
    rotation: [
      -0.8727,
      0,
      0
    ],
    cubes: [
      {
        uv: [
          0,
          27
        ],
        box: [
          -1.856,
          -0.1,
          -1.09,
          4,
          5,
          4
        ],
        inflate: 0
      }
    ]
  },
  {
    name: "left_leg",
    parent: -1,
    offset: [
      0.936,
      -5,
      0
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: []
  },
  {
    name: "left_leg_r1",
    parent: 9,
    offset: [
      1,
      0,
      0
    ],
    rotation: [
      0.7854,
      0,
      0
    ],
    cubes: [
      {
        uv: [
          16,
          27
        ],
        box: [
          -2.088,
          -0.1,
          -2,
          4,
          5,
          4
        ],
        inflate: 0
      }
    ]
  }
], Z = [
  {
    name: "body",
    parent: -1,
    offset: [
      0,
      -3,
      2.325
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: [
      {
        uv: [
          3,
          19
        ],
        box: [
          -3,
          -4,
          -4.525,
          6,
          1,
          6
        ],
        inflate: 0
      },
      {
        uv: [
          0,
          15
        ],
        box: [
          -4,
          -3,
          -3.525,
          8,
          6,
          6
        ],
        inflate: 0
      }
    ]
  },
  {
    name: "body_r1",
    parent: 0,
    offset: [
      0,
      -1,
      -4.325
    ],
    rotation: [
      0,
      0,
      -3.1416
    ],
    cubes: [
      {
        uv: [
          3,
          18
        ],
        box: [
          -4,
          -3,
          -2.2,
          8,
          6,
          3
        ],
        inflate: 0
      }
    ]
  },
  {
    name: "head",
    parent: 0,
    offset: [
      0,
      -6,
      -0.2
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: [
      {
        uv: [
          37,
          8
        ],
        box: [
          -1,
          -7,
          -3.3,
          2,
          4,
          2
        ],
        inflate: -0.015
      },
      {
        uv: [
          37,
          0
        ],
        box: [
          -2,
          -11,
          -4.3,
          4,
          4,
          4
        ],
        inflate: -0.015
      },
      {
        uv: [
          0,
          0
        ],
        box: [
          -4,
          -3,
          -7.325,
          8,
          5,
          10
        ],
        inflate: 0
      },
      {
        uv: [
          56,
          0
        ],
        box: [
          -1,
          0,
          -8.325,
          2,
          3,
          2
        ],
        inflate: 0
      }
    ]
  },
  {
    name: "right_arm",
    parent: 0,
    offset: [
      -4,
      -5.6,
      -1.8
    ],
    rotation: [
      0.4363,
      0,
      0
    ],
    cubes: []
  },
  {
    name: "right_arm_r1",
    parent: 3,
    offset: [
      0,
      0.0893,
      0.1198
    ],
    rotation: [
      -1.0472,
      0,
      0
    ],
    cubes: [
      {
        uv: [
          36,
          16
        ],
        box: [
          -3.075,
          -0.9733,
          -1.9966,
          3,
          10,
          4
        ],
        inflate: 0
      }
    ]
  },
  {
    name: "left_arm",
    parent: 0,
    offset: [
      4,
      -5.6,
      -1.7
    ],
    rotation: [
      0.4363,
      0,
      0
    ],
    cubes: []
  },
  {
    name: "left_arm_r1",
    parent: 5,
    offset: [
      0,
      -15e-4,
      -0.0808
    ],
    rotation: [
      -1.0472,
      0,
      0
    ],
    cubes: [
      {
        uv: [
          50,
          16
        ],
        box: [
          0.075,
          -1.0443,
          -1.8997,
          3,
          10,
          4
        ],
        inflate: 0
      }
    ]
  },
  {
    name: "right_leg",
    parent: -1,
    offset: [
      -2.1,
      -2.1,
      -2.075
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: []
  },
  {
    name: "right_leg_r1",
    parent: 7,
    offset: [
      0.05,
      -1.9,
      1.075
    ],
    rotation: [
      -1.5708,
      0,
      0
    ],
    cubes: [
      {
        uv: [
          0,
          27
        ],
        box: [
          -2,
          0.975,
          0,
          4,
          5,
          4
        ],
        inflate: 0
      }
    ]
  },
  {
    name: "left_leg",
    parent: -1,
    offset: [
      2,
      -2,
      -2.075
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: []
  },
  {
    name: "left_leg_r1",
    parent: 9,
    offset: [
      0.05,
      -2,
      1.075
    ],
    rotation: [
      -1.5708,
      0,
      0
    ],
    cubes: [
      {
        uv: [
          16,
          27
        ],
        box: [
          -2,
          0.975,
          0,
          4,
          5,
          4
        ],
        inflate: 0
      }
    ]
  }
], j = [
  {
    name: "body",
    parent: -1,
    offset: [
      0,
      -5,
      0
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: [
      {
        uv: [
          0,
          15
        ],
        box: [
          -4,
          -6,
          -3,
          8,
          6,
          6
        ],
        inflate: 0
      }
    ]
  },
  {
    name: "head",
    parent: 0,
    offset: [
      0,
      -6,
      0
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: [
      {
        uv: [
          0,
          0
        ],
        box: [
          -4,
          -5,
          -5,
          8,
          5,
          10
        ],
        inflate: 0
      },
      {
        uv: [
          56,
          0
        ],
        box: [
          -1,
          -2,
          -6,
          2,
          3,
          2
        ],
        inflate: 0
      },
      {
        uv: [
          37,
          8
        ],
        box: [
          -1,
          -9,
          -1,
          2,
          4,
          2
        ],
        inflate: -0.015
      },
      {
        uv: [
          37,
          0
        ],
        box: [
          -2,
          -13,
          -2,
          4,
          4,
          4
        ],
        inflate: -0.015
      }
    ]
  },
  {
    name: "right_arm",
    parent: 0,
    offset: [
      -4,
      -6,
      0
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: []
  },
  {
    name: "right_arm_r1",
    parent: 2,
    offset: [
      1,
      1,
      0
    ],
    rotation: [
      0,
      0,
      1.9199
    ],
    cubes: [
      {
        uv: [
          36,
          16
        ],
        box: [
          -1.5,
          -5,
          -2,
          3,
          10,
          4
        ],
        inflate: 0
      }
    ]
  },
  {
    name: "rightItem",
    parent: 2,
    offset: [
      -1,
      7.4,
      -1
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: []
  },
  {
    name: "left_arm",
    parent: 0,
    offset: [
      4,
      -6,
      0
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: []
  },
  {
    name: "left_arm_r1",
    parent: 5,
    offset: [
      -1,
      1,
      0
    ],
    rotation: [
      0,
      0,
      -1.9199
    ],
    cubes: [
      {
        uv: [
          50,
          16
        ],
        box: [
          -1.5,
          -5,
          -2,
          3,
          10,
          4
        ],
        inflate: 0
      }
    ]
  },
  {
    name: "right_leg",
    parent: -1,
    offset: [
      -3,
      -5,
      0
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: []
  },
  {
    name: "right_leg_r1",
    parent: 7,
    offset: [
      0.35,
      2,
      0.01
    ],
    rotation: [
      0,
      0,
      0.2618
    ],
    cubes: [
      {
        uv: [
          0,
          27
        ],
        box: [
          -2,
          -2.5,
          -2,
          4,
          5,
          4
        ],
        inflate: 0
      }
    ]
  },
  {
    name: "left_leg",
    parent: -1,
    offset: [
      1,
      -5,
      0
    ],
    rotation: [
      0,
      0,
      0
    ],
    cubes: []
  },
  {
    name: "left_leg_r1",
    parent: 9,
    offset: [
      1.65,
      2,
      0
    ],
    rotation: [
      0,
      0,
      -0.2618
    ],
    cubes: [
      {
        uv: [
          16,
          27
        ],
        box: [
          -2,
          -2.5,
          -2,
          4,
          5,
          4
        ],
        inflate: 0
      }
    ]
  }
], k = {
  standing: H,
  running: O,
  sitting: Z,
  star: j
};
async function J(F, v, E) {
  const h = ["oxidized", "weathered", "exposed"].find((o) => F.includes(o)), I = `entity/copper_golem/copper_golem${h ? `_${h}` : ""}`, u = await E.getTexture(I);
  u.magFilter = e.NearestFilter, u.minFilter = e.NearestFilter, u.generateMipmaps = !1;
  const P = new e.MeshStandardMaterial({ map: u, roughness: 1 }), d = v.copper_golem_pose, S = k[d] ?? k.standing, w = [], c = new e.Group(), T = { north: 0, east: -Math.PI / 2, south: Math.PI, west: Math.PI / 2 }, Y = new e.Matrix4().makeRotationY(T[v.facing] ?? 0).multiply(new e.Matrix4().makeTranslation(0, -0.5, 0)).multiply(new e.Matrix4().makeScale(1 / 16, -1 / 16, 1 / 16));
  for (const o of S) {
    const y = new e.Matrix4().makeTranslation(...o.offset).multiply(
      new e.Matrix4().makeRotationFromEuler(
        new e.Euler(...o.rotation, "ZYX")
      )
    ), M = o.parent < 0 ? y : w[o.parent].clone().multiply(y);
    w.push(M);
    for (const m of o.cubes) {
      const [G, R, $, a, r, t] = m.box, [i, s] = m.uv, b = m.inflate, f = new e.BoxGeometry(a + 2 * b, r + 2 * b, t + 2 * b), z = [
        [i + t + a, s + t, t, r],
        [i, s + t, t, r],
        [i + t + a, s, a, t],
        [i + t, s, a, t],
        [i + 2 * t + a, s + t, a, r],
        [i + t, s + t, a, r]
      ], p = f.getAttribute("uv");
      for (let n = 0; n < 6; n++) {
        const [g, N, A, B] = z[n];
        for (let x = 0; x < 4; x++) {
          const _ = n * 4 + x;
          p.setXY(
            _,
            (g + p.getX(_) * A) / 64,
            1 - (N + p.getY(_) * B) / 64
          );
        }
      }
      f.translate(G + a / 2, R + r / 2, $ + t / 2), f.applyMatrix4(Y.clone().multiply(M));
      const l = f.index;
      for (let n = 0; n < l.count; n += 3) {
        const g = l.getX(n);
        l.setX(n, l.getX(n + 2)), l.setX(n + 2, g);
      }
      const X = new e.Mesh(f, P);
      X.name = o.name, c.add(X);
    }
  }
  return c.name = `copper_golem_statue:${d ?? "standing"}`, C(c), c;
}
export {
  J as buildCopperGolemStatue
};
