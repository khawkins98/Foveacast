// heerich@0.14.0 — vendored ESM build. Source: https://github.com/meodai/heerich
// Upstream license: MIT. Do not edit; regenerate via scripts/vendor-update.sh if upgrading.
//#region src/bsp.js
var e = 1e-4, t = class {
	constructor(e = 50) {
		this.nodes = [], this.cellSize = e, this.grid = /* @__PURE__ */ new Map();
	}
	_cellKeys(e, t, n, r) {
		let i = this.cellSize, a = Math.floor(e / i), o = Math.floor(t / i), s = Math.floor(n / i), c = Math.floor(r / i), l = [];
		for (let e = a; e <= s; e++) for (let t = o; t <= c; t++) l.push(e << 16 ^ t);
		return l;
	}
	getOverlapping(e, t, n, r) {
		let i = [], a = /* @__PURE__ */ new Set(), o = this._cellKeys(e, t, n, r);
		for (let s = 0; s < o.length; s++) {
			let c = this.grid.get(o[s]);
			if (c) for (let o = 0; o < c.length; o++) {
				let s = c[o];
				if (a.has(s)) continue;
				a.add(s);
				let l = this.nodes[s];
				n < l.bounds.minX || e > l.bounds.maxX || r < l.bounds.minY || t > l.bounds.maxY || i.push(l.poly);
			}
		}
		return i;
	}
	clip(t) {
		let n = [t];
		for (let e of this.nodes) {
			if (n.length === 0) return [];
			let t = [], r = e.poly, i = e.bounds;
			for (let e of n) {
				let n = Infinity, a = Infinity, o = -Infinity, s = -Infinity;
				for (let t = 0; t < e.length; t++) {
					let r = e[t];
					r[0] < n && (n = r[0]), r[1] < a && (a = r[1]), r[0] > o && (o = r[0]), r[1] > s && (s = r[1]);
				}
				if (o < i.minX || n > i.maxX || s < i.minY || a > i.maxY) {
					t.push(e);
					continue;
				}
				let c = this.subtractConvex(e, r);
				t.push(...c);
			}
			n = t;
		}
		return n.filter((t) => this.calcArea(t) > e);
	}
	insert(t, n, r, i, a) {
		let o = this.calcSignedArea(t);
		if (Math.abs(o) < e) return;
		let s = t;
		if (o > 0 && (s = [...t].reverse()), n === void 0) {
			n = Infinity, r = Infinity, i = -Infinity, a = -Infinity;
			for (let e = 0; e < s.length; e++) {
				let t = s[e];
				t[0] < n && (n = t[0]), t[1] < r && (r = t[1]), t[0] > i && (i = t[0]), t[1] > a && (a = t[1]);
			}
		}
		this.nodes.push({
			poly: s,
			bounds: {
				minX: n,
				minY: r,
				maxX: i,
				maxY: a
			}
		});
		let c = this.nodes.length - 1, l = this._cellKeys(n, r, i, a);
		for (let e = 0; e < l.length; e++) {
			let t = l[e], n = this.grid.get(t);
			n || (n = [], this.grid.set(t, n)), n.push(c);
		}
	}
	subtractConvex(t, n) {
		let r = [], i = t;
		for (let t = 0; t < n.length && !(!i || i.length < 3); t++) {
			let a = n[t], o = n[(t + 1) % n.length], s = this.splitPolygonByLine(i, a, o);
			s.front && s.front.length > 2 && this.calcArea(s.front) > e && r.push(s.front), i = s.back && s.back.length > 2 ? s.back : null;
		}
		return r;
	}
	splitPolygonByLine(t, n, r) {
		let i = [], a = [], o = (t) => {
			let i = (r[0] - n[0]) * (t[1] - n[1]) - (r[1] - n[1]) * (t[0] - n[0]);
			return i > e ? 1 : i < -e ? -1 : 0;
		}, s = t[t.length - 1], c = o(s);
		for (let e = 0; e < t.length; e++) {
			let l = t[e], u = o(l);
			if (u > 0) {
				if (c < 0) {
					let e = this.lineIntersect(n, r, s, l);
					e && (i.push(e), a.push(e));
				}
				i.push(l);
			} else if (u < 0) {
				if (c > 0) {
					let e = this.lineIntersect(n, r, s, l);
					e && (i.push(e), a.push(e));
				}
				a.push(l);
			} else i.push(l), a.push(l);
			s = l, c = u;
		}
		return {
			front: i,
			back: a
		};
	}
	lineIntersect(t, n, r, i) {
		let a = n[0] - t[0], o = n[1] - t[1], s = i[0] - r[0], c = i[1] - r[1], l = a * c - o * s;
		if (Math.abs(l) < e) return null;
		let u = r[0] - t[0], d = r[1] - t[1], f = (u * c - d * s) / l;
		return [t[0] + f * a, t[1] + f * o];
	}
	calcSignedArea(e) {
		let t = 0;
		for (let n = 0; n < e.length; n++) {
			let r = e[n], i = e[(n + 1) % e.length];
			t += r[0] * i[1] - i[0] * r[1];
		}
		return t / 2;
	}
	calcArea(e) {
		return Math.abs(this.calcSignedArea(e));
	}
}, n = /([MLHVCSQTZAmlhvcsqtza])/, r = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
function i(e) {
	let t = [], n;
	for (r.lastIndex = 0; (n = r.exec(e)) !== null;) t.push(parseFloat(n[0]));
	return t;
}
function a(e) {
	let t = e.split(n).filter(Boolean), r = [];
	for (let e = 0; e < t.length; e++) {
		let a = t[e].trim();
		a && n.test(a) && a.length === 1 && (r.push({
			cmd: a,
			args: i(t[e + 1] || "")
		}), e++);
	}
	return r;
}
var o = Math.PI * 2;
function s(e, t, n, r, i, a, s, c, l) {
	if (n === 0 || r === 0) return [[
		e,
		t,
		c,
		l,
		c,
		l
	]];
	let u = Math.sin(i), d = Math.cos(i), f = (e - c) / 2, p = (t - l) / 2, m = d * f + u * p, h = -u * f + d * p, g = n * n, _ = r * r, v = m * m, y = h * h, b = v / g + y / _;
	if (b > 1) {
		let e = Math.sqrt(b);
		n *= e, r *= e, g = n * n, _ = r * r;
	}
	let x = (g * _ - g * y - _ * v) / (g * y + _ * v);
	x < 0 && (x = 0);
	let S = Math.sqrt(x);
	a === s && (S = -S);
	let C = S * n * h / r, w = -S * r * m / n, T = Math.atan2((h - w) / r, (m - C) / n), E = Math.atan2((-h - w) / r, (-m - C) / n) - T;
	!s && E > 0 ? E -= o : s && E < 0 && (E += o);
	let D = Math.max(1, Math.ceil(Math.abs(E) / (Math.PI / 2))), O = E / D, k = [], A = 4 / 3 * Math.tan(O / 4), j = (e + c) / 2 + d * C - u * w, M = (t + l) / 2 + u * C + d * w, N = T;
	for (let e = 0; e < D; e++) {
		let t = Math.cos(N), i = Math.sin(N), a = N + O, o = Math.cos(a), s = Math.sin(a), f = t - A * i, p = i + A * t, m = o + A * s, h = s - A * o;
		k.push([
			d * n * f - u * r * p + j,
			u * n * f + d * r * p + M,
			d * n * m - u * r * h + j,
			u * n * m + d * r * h + M,
			e === D - 1 ? c : d * n * o - u * r * s + j,
			e === D - 1 ? l : u * n * o + d * r * s + M
		]), N = a;
	}
	return k;
}
function c(e) {
	let t = a(e), n = [], r = 0, i = 0, o = 0, c = 0;
	for (let { cmd: e, args: a } of t) {
		let t = e.toUpperCase(), l = e !== t;
		if (t === "Z") {
			n.push({
				cmd: "Z",
				coords: null
			}), r = o, i = c;
			continue;
		}
		let u = t === "M" || t === "L" ? 2 : t === "H" || t === "V" ? 1 : t === "C" ? 6 : t === "S" || t === "Q" ? 4 : t === "T" ? 2 : t === "A" ? 7 : 0;
		if (u) for (let e = 0; e < a.length; e += u) {
			let d = a.slice(e, e + u);
			if (t === "H") {
				let e = l ? r + d[0] : d[0];
				n.push({
					cmd: "L",
					coords: new Float64Array([e, i])
				}), r = e;
				continue;
			}
			if (t === "V") {
				let e = l ? i + d[0] : d[0];
				n.push({
					cmd: "L",
					coords: new Float64Array([r, e])
				}), i = e;
				continue;
			}
			if (t === "A") {
				let e = l ? r + d[5] : d[5], t = l ? i + d[6] : d[6], a = s(r, i, d[0], d[1], d[2] * Math.PI / 180, d[3], d[4], e, t);
				for (let e of a) n.push({
					cmd: "C",
					coords: new Float64Array(e)
				});
				r = e, i = t;
				continue;
			}
			let f = new Float64Array(d.length);
			for (let e = 0; e < d.length; e += 2) f[e] = l ? r + d[e] : d[e], f[e + 1] = l ? i + d[e + 1] : d[e + 1];
			let p = e > 0 && t === "M" ? "L" : t;
			n.push({
				cmd: p,
				coords: f
			}), r = f[f.length - 2], i = f[f.length - 1], t === "M" && e === 0 && (o = r, c = i);
		}
	}
	return n;
}
function l(e, t) {
	let n = "";
	for (let r = 0; r < e.length; r++) {
		let i = e[r];
		if (i.cmd === "Z") {
			n += "Z";
			continue;
		}
		let a = i.coords;
		n += i.cmd;
		for (let e = 0; e < a.length; e += 2) {
			let r = a[e], i = a[e + 1], o = 1 - r, s = 1 - i;
			e > 0 && (n += " "), n += o * s * t[0] + r * s * t[2] + r * i * t[4] + o * i * t[6] + " " + (o * s * t[1] + r * s * t[3] + r * i * t[5] + o * i * t[7]);
		}
		n += " ";
	}
	return n;
}
function u(e) {
	let t = /(<path\b[^>]*?\bd=(["']))([^"']*?)(\2[^>]*?>)/gi, n = [], r = 0, i;
	for (; (i = t.exec(e)) !== null;) {
		let a = e.slice(r, i.index);
		n.push({
			before: a + i[1],
			ops: c(i[3]),
			after: i[4]
		}), r = t.lastIndex;
	}
	return {
		fragments: n,
		tail: e.slice(r)
	};
}
function d(e, t) {
	let n = "";
	for (let r = 0; r < e.fragments.length; r++) {
		let i = e.fragments[r];
		n += i.before + l(i.ops, t) + i.after;
	}
	return n + e.tail;
}
//#endregion
//#region src/hatch.js
function f(e) {
	let t = [], n = null, r = /([MLZmlz])([-0-9.e\s]*)/gi, i;
	for (; (i = r.exec(e)) !== null;) {
		let e = i[1].toUpperCase(), r = i[2].trim() ? i[2].trim().split(/[\s,]+/).filter(Boolean).map(Number) : [];
		e === "M" ? (n && n.length && t.push(n), n = r.length >= 2 ? [[r[0], r[1]]] : []) : e === "L" ? n && r.length >= 2 && n.push([r[0], r[1]]) : e === "Z" && n && n.length && (t.push(n), n = null);
	}
	return n && n.length && t.push(n), t;
}
function p(e, t, n, r, i) {
	let a = [], o = i.length;
	for (let s = 0; s < o; s++) {
		let c = i[s][0], l = i[s][1], u = i[(s + 1) % o][0], d = i[(s + 1) % o][1], f = u - c, p = d - l, m = n * p - r * f;
		if (Math.abs(m) < 1e-10) continue;
		let h = c - e, g = l - t, _ = (h * p - g * f) / m, v = (h * r - g * n) / m;
		v >= -1e-10 && v < .9999999999 && a.push(_);
	}
	if (a.length < 2) return [];
	a.sort((e, t) => e - t);
	let s = [];
	for (let i = 0; i + 1 < a.length; i += 2) {
		let o = a[i], c = a[i + 1];
		c - o < 1e-10 || s.push([
			e + o * n,
			t + o * r,
			e + c * n,
			t + c * r
		]);
	}
	return s;
}
function m(e, t, n, r) {
	let i = t.angle === void 0 ? 45 : t.angle, a = t.period === void 0 ? 2 : t.period;
	if (a <= 0) return "";
	let o = i * Math.PI / 180, s = Math.cos(o), c = Math.sin(o), l = n ? f(n) : [[
		[e[0], e[1]],
		[e[2], e[3]],
		[e[4], e[5]],
		[e[6], e[7]]
	]], u = Infinity, d = Infinity, m = -Infinity, h = -Infinity;
	for (let e of l) for (let [t, n] of e) t < u && (u = t), n < d && (d = n), t > m && (m = t), n > h && (h = n);
	let g = [
		u,
		m,
		m,
		u
	], _ = [
		d,
		d,
		h,
		h
	], v = Infinity, y = -Infinity;
	for (let e = 0; e < 4; e++) {
		let t = -g[e] * c + _[e] * s;
		t < v && (v = t), t > y && (y = t);
	}
	let b = ` stroke="${t.stroke ?? r?.stroke ?? "currentColor"}" stroke-width="${t.strokeWidth ?? r?.strokeWidth ?? 1}" fill="none"${t.opacity === void 0 ? "" : ` opacity="${t.opacity}"`}`, x = (e) => Math.round(e * 1e4) / 1e4, S = "", C = Math.ceil(v / a) * a;
	for (let e = C; e <= y; e += a) {
		let t = -e * c, n = e * s;
		for (let e of l) {
			let r = p(t, n, s, c, e);
			for (let [e, t, n, i] of r) S += `<line x1="${x(e)}" y1="${x(t)}" x2="${x(n)}" y2="${x(i)}"${b}/>`;
		}
	}
	return S;
}
//#endregion
//#region src/svg-renderer.js
var h = {}, g = /* @__PURE__ */ new WeakMap(), _ = class {
	render(e, n = {}) {
		let r = n.padding || 20, i = e;
		if (n.occlusion || n.resolveOcclusion) {
			i = [];
			let r = [...e].reverse(), a = new t();
			for (let e of r) {
				if (!e.points) continue;
				let t = e.points.data, r = e.points.length, o = [], s = Infinity, c = Infinity, l = -Infinity, u = -Infinity;
				for (let e = 0; e < r; e++) {
					let n = t[e * 2], r = t[e * 2 + 1];
					o.push([n, r]), n < s && (s = n), r < c && (c = r), n > l && (l = n), r > u && (u = r);
				}
				let d = a.getOverlapping(s, c, l, u), f = !0, p = null;
				if (d.length > 0) if (n.resolveOcclusion) p = n.resolveOcclusion(o, d), p || (f = !1);
				else {
					let e = a.clip(o);
					if (e.length === 0) f = !1;
					else {
						let t = 0;
						for (let n of e) t += a.calcArea(n);
						let n = a.calcArea(o);
						if (t < n * .999) {
							let t = "";
							for (let n of e) {
								for (let e = 0; e < n.length; e++) t += e === 0 ? `M${n[e][0]} ${n[e][1]}` : `L${n[e][0]} ${n[e][1]}`;
								t += "Z";
							}
							p = t;
						}
					}
				}
				f && (a.insert(o, s, c, l, u), p && typeof p == "string" ? i.push({
					...e,
					_pathD: p
				}) : i.push(e));
			}
			i.reverse();
		}
		let a = v(i), o = n.viewBox ? n.viewBox[0] : a.x - r, s = n.viewBox ? n.viewBox[1] : a.y - r, c = n.viewBox ? n.viewBox[2] : a.w + r * 2, l = n.viewBox ? n.viewBox[3] : a.h + r * 2, u = n.offset || [0, 0], f = n.tileW || 1, p = n.faceAttributes || null, h = n.decals || null, g = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${o} ${s} ${c} ${l}" style="width:100%; height:100%;">`];
		n.prepend && g.push(n.prepend), g.push(`<g transform="translate(${u[0]}, ${u[1]})">`);
		for (let e = 0; e < i.length; e++) {
			let t = i[e];
			if (t.type === "content") {
				g.push(`<g transform="translate(${t._px}, ${t._py}) scale(${t._scale})" style="--x:${t._px};--y:${t._py};--z:${t._pos[2]};--scale:${t._scale};--tile:${f}">`, t.content, "</g>");
				continue;
			}
			let n = t.points.data, r = t.voxel, a = t.style, o = "";
			if (p) {
				let e = p(t);
				if (e) {
					let t = {};
					for (let [n, r] of Object.entries(e)) r == null || n === "decal" || (n === "fill" || n === "stroke" || n === "strokeWidth" || n === "opacity" || n === "strokeDasharray" || n === "strokeLinecap" || n === "strokeLinejoin" || n === "fillOpacity" || n === "strokeOpacity" ? t[n] = r : o += ` ${n}="${r}"`);
					Object.keys(t).length > 0 && (a = {
						...a,
						...t
					});
				}
			}
			let s = "";
			if (r.meta) for (let [e, t] of Object.entries(r.meta)) s += ` data-${e}="${t}"`;
			if (t._pathD ? g.push(`<path d="${t._pathD}"${y(a)} data-voxel="${r.x},${r.y},${r.z}" data-x="${r.x}" data-y="${r.y}" data-z="${r.z}" data-face="${t.type}"${s}${o} />`) : g.push(`<polygon points="${n[0]},${n[1]} ${n[2]},${n[3]} ${n[4]},${n[5]} ${n[6]},${n[7]}"${y(a)} data-voxel="${r.x},${r.y},${r.z}" data-x="${r.x}" data-y="${r.y}" data-z="${r.z}" data-face="${t.type}"${s}${o} />`), a && a.hatch && g.push(m(n, a.hatch, t._pathD || null, a)), a && a.decal && h) {
				let e = a.decal, t = typeof e == "string" ? e : e.name, r = h && h.get(t);
				if (r) {
					let t = "";
					typeof e == "object" && e.style && (t = y(e.style));
					let i = d(r._prepared, n), a = t + o;
					a ? g.push(i.replace(/<path\b/gi, `<path${a}`)) : g.push(i);
				}
			}
		}
		return g.push("</g>"), n.append && g.push(n.append), g.push("</svg>"), g.join("");
	}
};
function v(e) {
	let t = Infinity, n = Infinity, r = -Infinity, i = -Infinity;
	if (e.length === 0) return {
		x: 0,
		y: 0,
		w: 100,
		h: 100
	};
	for (let a = 0; a < e.length; a++) {
		let o = e[a].points.data;
		for (let e = 0; e < o.length; e += 2) {
			let a = o[e], s = o[e + 1];
			a < t && (t = a), s < n && (n = s), a > r && (r = a), s > i && (i = s);
		}
	}
	return {
		x: t,
		y: n,
		w: r - t,
		h: i - n
	};
}
function y(e) {
	let t = g.get(e);
	if (t) return t;
	let n = {
		strokeLinejoin: "round",
		...e
	}, r = "";
	for (let e in n) {
		if (e === "decal" || e === "hatch") continue;
		let t = n[e];
		if (t != null) {
			let n = h[e] || (h[e] = e.replace(/([A-Z])/g, "-$1").toLowerCase());
			r += ` ${n}="${t}"`;
		}
	}
	return g.set(e, r), r;
}
//#endregion
//#region src/points.js
var b = class e {
	constructor(e) {
		this.data = e;
	}
	get length() {
		return this.data.length >> 1;
	}
	x(e) {
		return this.data[e * 2];
	}
	y(e) {
		return this.data[e * 2 + 1];
	}
	*[Symbol.iterator]() {
		let e = this.data;
		for (let t = 0; t < e.length; t += 2) yield [e[t], e[t + 1]];
	}
	static quad(t, n, r, i, a, o, s, c) {
		return new e([
			t,
			n,
			r,
			i,
			a,
			o,
			s,
			c
		]);
	}
};
//#endregion
//#region src/shapes.js
function* x(e, t) {
	let [n, r, i] = e, [a, o, s] = t;
	for (let e = i; e < i + s; e++) for (let t = r; t < r + o; t++) for (let r = n; r < n + a; r++) yield [
		r,
		t,
		e
	];
}
function* S(e, t) {
	let [n, r, i] = e;
	for (let e = Math.ceil(i - t); e <= Math.floor(i + t); e++) for (let a = Math.ceil(r - t); a <= Math.floor(r + t); a++) for (let o = Math.ceil(n - t); o <= Math.floor(n + t); o++) {
		let s = n - o, c = r - a, l = i - e;
		s * s + c * c + l * l <= t * t && (yield [
			o,
			a,
			e
		]);
	}
}
function* C(e, t, n, r) {
	let [i, a, o] = e, [s, c, l] = t, u = s - i, d = c - a, f = l - o, p = Math.max(Math.abs(u), Math.abs(d), Math.abs(f)), m = n > 0 ? /* @__PURE__ */ new Set() : null, h = function* (e) {
		if (!m) {
			yield* e;
			return;
		}
		for (let t of e) {
			let e = t[0] + 512 << 20 | t[1] + 512 << 10 | t[2] + 512;
			m.has(e) || (m.add(e), yield t);
		}
	}, g = p === 0 ? [[
		i,
		a,
		o
	]] : Array.from({ length: p + 1 }, (e, t) => {
		let n = t / p;
		return [
			Math.round(i + n * u),
			Math.round(a + n * d),
			Math.round(o + n * f)
		];
	});
	for (let [e, t, i] of g) if (r === "rounded" && n > 0) yield* h(S([
		e,
		t,
		i
	], n));
	else if (r === "square" && n > 0) {
		let r = Math.floor(n);
		yield* h(x([
			e - r,
			t - r,
			i - r
		], [
			r * 2 + 1,
			r * 2 + 1,
			r * 2 + 1
		]));
	} else yield [
		e,
		t,
		i
	];
}
function* w(e, t) {
	let [[n, r, i], [a, o, s]] = e;
	for (let e = i; e < s; e++) for (let i = r; i < o; i++) for (let r = n; r < a; r++) t(r, i, e) && (yield [
		r,
		i,
		e
	]);
}
//#endregion
//#region src/heerich.js
function T(e, t, n) {
	let r = n.data, i = r.length >> 1, a = 0;
	for (let n = 0; n < i; n++) {
		let o = (n + 1) % i, s = r[o * 2] - r[n * 2], c = r[o * 2 + 1] - r[n * 2 + 1], l = s * (t - r[n * 2 + 1]) - c * (e - r[n * 2]);
		if (l === 0) continue;
		let u = l > 0 ? 1 : -1;
		if (a === 0) a = u;
		else if (a !== u) return !1;
	}
	return a !== 0;
}
var E = [
	[
		0,
		-1,
		0,
		"bottom"
	],
	[
		0,
		1,
		0,
		"top"
	],
	[
		-1,
		0,
		0,
		"right"
	],
	[
		1,
		0,
		0,
		"left"
	],
	[
		0,
		0,
		-1,
		"back"
	],
	[
		0,
		0,
		1,
		"front"
	]
], D = class e {
	constructor(e = {}) {
		let t = e.tile || 10, n = typeof t == "number" ? [
			t,
			t,
			t
		] : t.length === 2 ? [
			t[0],
			t[1],
			t[0]
		] : t;
		this.defaultStyle = e.style || {
			fill: "#aaaaaa",
			stroke: "#000000",
			strokeWidth: 1
		};
		let r = e.camera || {
			type: "oblique",
			angle: 45,
			distance: 15
		};
		this.renderOptions = {
			projection: r.type || "oblique",
			tileW: n[0],
			tileH: n[1],
			tileZ: n[2],
			depthOffsetX: 15,
			depthOffsetY: -15,
			cameraX: 5,
			cameraY: 5,
			cameraDistance: 10
		}, this.defaultGap = e.gap || 0, this.setCamera(r), this.voxels = /* @__PURE__ */ new Map(), this.decals = /* @__PURE__ */ new Map(), this._epoch = 0, this._cachedEpoch = -1, this._cachedFaces = null, this._cachedRawEpoch = -1, this._cachedRawFaces = null, this._svgRenderer = null, this._batching = !1, this._dirtyKeys = /* @__PURE__ */ new Set(), this._faceCache3D = /* @__PURE__ */ new Map();
	}
	setCamera(e = {}) {
		let t = e.type || this.renderOptions.projection;
		if (this.renderOptions.projection = t, t === "oblique") {
			let t = e.angle === void 0 ? 45 : e.angle, n = e.distance === void 0 ? 15 : e.distance, r = Math.PI / 180 * t, i = this.renderOptions.tileZ / this.renderOptions.tileW;
			this.renderOptions.depthOffsetX = Math.cos(r) * n * i, this.renderOptions.depthOffsetY = Math.sin(r) * n * i;
		} else if (t === "orthographic" || t === "isometric") this.renderOptions.angle = (e.angle === void 0 ? 45 : e.angle) * (Math.PI / 180), this.renderOptions.pitch = t === "isometric" ? Math.PI / 180 * 35.264 : (e.pitch === void 0 ? 35.264 : e.pitch) * (Math.PI / 180);
		else {
			let t = e.position || [5, 5];
			this.renderOptions.cameraX = t[0], this.renderOptions.cameraY = t[1], this.renderOptions.cameraDistance = e.distance === void 0 ? 10 : e.distance;
		}
		this._faceCache3D && this._faceCache3D.clear(), this._invalidate();
	}
	_k(e, t, n) {
		return (e + 512 & 1023) << 20 | (t + 512 & 1023) << 10 | n + 512 & 1023;
	}
	_invalidate() {
		this._epoch++, this._batching || (this._cachedFaces = null, this._cachedRawFaces = null);
	}
	_markDirty(e, t, n) {
		this._dirtyKeys.add(this._k(e, t, n));
		for (let [r, i, a] of E) this._dirtyKeys.add(this._k(e + r, t + i, n + a));
	}
	get epoch() {
		return this._epoch;
	}
	batch(e) {
		this._batching = !0;
		try {
			e();
		} finally {
			this._batching = !1, this._cachedFaces = null, this._cachedRawFaces = null;
		}
	}
	static _bboxCenter(e, t) {
		let n = Infinity, r = Infinity, i = Infinity, a = -Infinity, o = -Infinity, s = -Infinity;
		for (let c of e) {
			let [e, l, u] = t(c);
			e < n && (n = e), e > a && (a = e), l < r && (r = l), l > o && (o = l), u < i && (i = u), u > s && (s = u);
		}
		return [
			(n + a) / 2,
			(r + o) / 2,
			(i + s) / 2
		];
	}
	static _rot90(e, t, n, r, i, a, o, s) {
		let c = e - a, l = t - o, u = n - s, d = (i % 4 + 4) % 4;
		for (let e = 0; e < d; e++) if (r === "z") {
			let e = c;
			c = -l, l = e;
		} else if (r === "y") {
			let e = c;
			c = -u, u = e;
		} else {
			let e = l;
			l = -u, u = e;
		}
		return [
			Math.round(a + c),
			Math.round(o + l),
			Math.round(s + u)
		];
	}
	*_rotateCoords(t, n) {
		if (!n) {
			yield* t;
			return;
		}
		let r = [...t], [i, a, o] = n.center || e._bboxCenter(r, (e) => e);
		for (let [t, s, c] of r) yield e._rot90(t, s, c, n.axis, n.turns, i, a, o);
	}
	rotate(t) {
		let n = [...this.voxels.values()], [r, i, a] = t.center || e._bboxCenter(n, (e) => [
			e.x,
			e.y,
			e.z
		]);
		this.voxels.clear(), this._faceCache3D.clear();
		for (let o of n) {
			let [n, s, c] = e._rot90(o.x, o.y, o.z, t.axis, t.turns, r, i, a);
			this.voxels.set(this._k(n, s, c), {
				...o,
				x: n,
				y: s,
				z: c
			});
		}
		this._invalidate();
	}
	_applyOp(e, t, n, r, i, a, o, s, c) {
		if (t === "intersect") {
			let t = /* @__PURE__ */ new Set();
			for (let [n, r, i] of e) {
				let e = this._k(n, r, i);
				this.voxels.has(e) && t.add(e);
			}
			for (let [e, n] of this.voxels.entries()) t.has(e) || (this._markDirty(n.x, n.y, n.z), this.voxels.delete(e));
			if (n) for (let e of t) {
				let t = this.voxels.get(e);
				t && (t.styles = this._resolveStyles(n, t.x, t.y, t.z, t.styles));
			}
		} else for (let [l, u, d] of e) {
			let e = this._k(l, u, d);
			if (this._markDirty(l, u, d), t === "union") {
				let t = {
					x: l,
					y: u,
					z: d,
					styles: this._resolveStyles(n || null, l, u, d)
				};
				if (r && (t.content = r), o) {
					let e = typeof o == "function" ? o(l, u, d) : o;
					e && (t.scale = e, t.scaleOrigin = (typeof s == "function" ? s(l, u, d) : s) || [
						.5,
						0,
						.5
					], t.opaque = !1);
				} else i === !1 && (t.opaque = !1);
				a && (t.meta = a);
				let f = c === void 0 ? this.defaultGap : c;
				f ? t.gap = f : c === 0 && (t.gap = 0), this.voxels.set(e, t);
			} else if (t === "subtract") {
				if (this.voxels.delete(e) && n) for (let [e, t, r, i] of E) {
					let a = l + e, o = u + t, s = d + r, c = this._k(a, o, s), f = this.voxels.get(c);
					if (f) {
						let e = this._resolveStyles(n, a, o, s);
						e[i] ? f.styles[i] = {
							...f.styles[i] || {},
							...e[i]
						} : e.default && (f.styles[i] = {
							...f.styles[i] || {},
							...e.default
						});
					}
				}
			} else if (t === "exclude") if (this.voxels.has(e)) this.voxels.delete(e);
			else {
				let t = {
					x: l,
					y: u,
					z: d,
					styles: this._resolveStyles(n || null, l, u, d)
				};
				if (r && (t.content = r), o) {
					let e = typeof o == "function" ? o(l, u, d) : o;
					e && (t.scale = e, t.scaleOrigin = (typeof s == "function" ? s(l, u, d) : s) || [
						.5,
						0,
						.5
					], t.opaque = !1);
				} else i === !1 && (t.opaque = !1);
				a && (t.meta = a);
				let f = c === void 0 ? this.defaultGap : c;
				f && (t.gap = f), this.voxels.set(e, t);
			}
		}
		this._invalidate();
	}
	_resolveStyles(e, t, n, r, i = null) {
		if (!e) return i ? { ...i } : { default: { ...this.defaultStyle } };
		let a = typeof e == "function" ? e(t, n, r) : e, o = i ? { ...i } : {};
		for (let [e, i] of Object.entries(a)) {
			let a = typeof i == "function" ? i(t, n, r) : i;
			o[e] ? Object.assign(o[e], a) : o[e] = { ...a };
		}
		return o;
	}
	clear() {
		this.voxels.clear(), this._faceCache3D.clear(), this._invalidate();
	}
	getVoxel(e) {
		return this.voxels.get(this._k(e[0], e[1], e[2])) || null;
	}
	hasVoxel(e) {
		return this.voxels.has(this._k(e[0], e[1], e[2]));
	}
	getNeighbors(e) {
		let [t, n, r] = e;
		return {
			top: this.getVoxel([
				t,
				n - 1,
				r
			]),
			bottom: this.getVoxel([
				t,
				n + 1,
				r
			]),
			left: this.getVoxel([
				t - 1,
				n,
				r
			]),
			right: this.getVoxel([
				t + 1,
				n,
				r
			]),
			front: this.getVoxel([
				t,
				n,
				r - 1
			]),
			back: this.getVoxel([
				t,
				n,
				r + 1
			])
		};
	}
	findVoxels(e) {
		let t = [];
		for (let n of this.voxels.values()) e(n) && t.push(n);
		return t;
	}
	*[Symbol.iterator]() {
		for (let e of this.voxels.values()) yield e;
	}
	toJSON() {
		let e = [];
		for (let [t, n] of this.voxels.entries()) {
			let t = {};
			for (let [e, r] of Object.entries(n.styles)) {
				if (typeof r == "function") {
					console.warn(`Heerich.toJSON: functional style on face "${e}" at [${n.x},${n.y},${n.z}] will be omitted`);
					continue;
				}
				t[e] = r;
			}
			let r = {
				x: n.x,
				y: n.y,
				z: n.z,
				styles: t
			};
			n.content && (r.content = n.content), n.opaque === !1 && (r.opaque = !1), n.meta && (r.meta = n.meta), n.scale && (r.scale = n.scale), n.scaleOrigin && (r.scaleOrigin = n.scaleOrigin), n.gap !== void 0 && (r.gap = n.gap), e.push(r);
		}
		return {
			tile: [
				this.renderOptions.tileW,
				this.renderOptions.tileH,
				this.renderOptions.tileZ
			],
			camera: this.renderOptions.projection === "oblique" ? {
				type: "oblique",
				depthOffsetX: this.renderOptions.depthOffsetX,
				depthOffsetY: this.renderOptions.depthOffsetY
			} : {
				type: "perspective",
				position: [this.renderOptions.cameraX, this.renderOptions.cameraY],
				distance: this.renderOptions.cameraDistance
			},
			style: { ...this.defaultStyle },
			gap: this.defaultGap || void 0,
			voxels: e,
			decals: this.decals.size > 0 ? Object.fromEntries(this.decals.entries()) : void 0
		};
	}
	static fromJSON(t) {
		let n = new e({
			tile: t.tile,
			camera: t.camera,
			style: t.style,
			gap: t.gap
		});
		for (let e of t.voxels) {
			let t = {
				x: e.x,
				y: e.y,
				z: e.z,
				styles: e.styles
			};
			e.content && (t.content = e.content), e.opaque === !1 && (t.opaque = !1), e.meta && (t.meta = e.meta), e.scale && (t.scale = e.scale), e.scaleOrigin && (t.scaleOrigin = e.scaleOrigin), e.gap && (t.gap = e.gap), n.voxels.set(n._k(e.x, e.y, e.z), t);
		}
		if (t.decals) for (let [e, r] of Object.entries(t.decals)) n.defineDecal(e, r);
		return n._invalidate(), n;
	}
	_resolveGeometry(e) {
		let t = e.type;
		if (t === "box" || t === "sphere" || t === "fill") {
			let n = e.bounds ? [
				e.bounds[1][0] - e.bounds[0][0],
				e.bounds[1][1] - e.bounds[0][1],
				e.bounds[1][2] - e.bounds[0][2]
			] : e.size == null ? [
				e.radius * 2 + 1,
				e.radius * 2 + 1,
				e.radius * 2 + 1
			] : typeof e.size == "number" ? [
				e.size,
				e.size,
				e.size
			] : e.size, r = e.position ?? (e.bounds ? e.bounds[0] : null) ?? [
				e.center[0] - Math.floor(n[0] / 2),
				e.center[1] - Math.floor(n[1] / 2),
				e.center[2] - Math.floor(n[2] / 2)
			], i = e.center ?? [
				r[0] + Math.floor(n[0] / 2),
				r[1] + Math.floor(n[1] / 2),
				r[2] + Math.floor(n[2] / 2)
			], a = e.radius ?? Math.floor(n[0] / 2);
			return t === "box" ? x(r, n) : t === "sphere" ? S(i, a) : w([r, [
				r[0] + n[0],
				r[1] + n[1],
				r[2] + n[2]
			]], e.test);
		}
		if (t === "line") return C(e.from, e.to, e.radius || 0, e.shape || "rounded");
		throw Error(`Unknown geometry type: "${t}"`);
	}
	defineDecal(e, t) {
		typeof t == "string" && (t = { content: t }), t._prepared = u(t.content), this.decals.set(e, t);
	}
	applyGeometry(e) {
		let t = this._resolveGeometry(e);
		e.rotate && (t = this._rotateCoords(t, e.rotate)), this._applyOp(t, e.mode || "union", e.style, e.content, e.opaque, e.meta, e.scale, e.scaleOrigin, e.gap);
	}
	removeGeometry(e) {
		this.applyGeometry({
			...e,
			mode: "subtract"
		});
	}
	addGeometry(e) {
		this.applyGeometry({
			...e,
			mode: "union"
		});
	}
	applyStyle(e) {
		if (!e.style) throw Error("applyStyle requires a style parameter");
		if (!e.type) {
			for (let [t, n] of this.voxels.entries()) n.styles = this._resolveStyles(e.style, n.x, n.y, n.z, n.styles);
			this._invalidate();
			return;
		}
		let t = this._resolveGeometry(e);
		for (let [n, r, i] of t) {
			let t = this._k(n, r, i), a = this.voxels.get(t);
			a && (a.styles = this._resolveStyles(e.style, n, r, i, a.styles));
		}
		this._invalidate();
	}
	static _scaleVertices(e, t, n, r, i, a) {
		let o = t + a[0], s = n + a[1], c = r + a[2];
		return e.map(([e, t, n]) => [
			o + (e - o) * i[0],
			s + (t - s) * i[1],
			c + (n - c) * i[2]
		]);
	}
	_buildFaces3D(t = null) {
		let n = (e, t, n) => {
			let r = this.voxels.get(this._k(e, t, n));
			return r && r.opaque !== !1;
		}, r = this._dirtyKeys, i = !t && r.size > 0 && this._faceCache3D.size > 0;
		if (i) for (let e of r) this._faceCache3D.delete(e);
		let a = [];
		for (let [o, s] of this.voxels.entries()) {
			if (i && !r.has(o)) {
				let e = this._faceCache3D.get(o);
				if (e) {
					for (let t = 0; t < e.length; t++) a.push(e[t]);
					continue;
				}
			}
			let { x: c, y: l, z: u, styles: d } = s;
			if (!s.scale && !s.gap && n(c - 1, l, u) && n(c + 1, l, u) && n(c, l - 1, u) && n(c, l + 1, u) && n(c, l, u - 1) && n(c, l, u + 1)) continue;
			let f = a.length;
			if (s.content) {
				a.push({
					type: "content",
					voxel: s,
					content: s.content,
					_pos: [
						c,
						l,
						u
					]
				}), t || this._faceCache3D.set(o, a.slice(f));
				continue;
			}
			let p = d.default ? {
				...this.defaultStyle,
				...d.default
			} : this.defaultStyle, m = (e) => {
				let t = d[e];
				return t ? {
					...p,
					...t
				} : p;
			}, h = s.scale, g = s.scaleOrigin, _ = s.gap, v = (e, t, n, r, i, a, o) => [
				t + (e[0] - t) * i,
				n + (e[1] - n) * a,
				r + (e[2] - r) * o
			], y = (n, r, i, o, d, f) => {
				if (t && t.has(n)) return;
				let p = [
					o,
					d,
					f
				];
				if (h && (p = v(p, c + g[0], l + g[1], u + g[2], h[0], h[1], h[2])), _) {
					let e = 1 - 2 * _;
					p = v(p, c + .5, l + .5, u + .5, e, e, e);
				}
				let y = h ? e._scaleVertices(r, c, l, u, h, g) : r;
				if (_) {
					let t = 1 - 2 * _;
					y = e._scaleVertices(y, c, l, u, [
						t,
						t,
						t
					], [
						.5,
						.5,
						.5
					]);
				}
				a.push({
					type: n,
					voxel: s,
					vertices: y,
					n: i,
					c: p,
					style: m(n)
				});
			};
			(h || _ || !n(c, l - 1, u)) && y("top", [
				[
					c,
					l,
					u
				],
				[
					c + 1,
					l,
					u
				],
				[
					c + 1,
					l,
					u + 1
				],
				[
					c,
					l,
					u + 1
				]
			], [
				0,
				-1,
				0
			], c + .5, l, u + .5), (h || _ || !n(c, l + 1, u)) && y("bottom", [
				[
					c,
					l + 1,
					u + 1
				],
				[
					c + 1,
					l + 1,
					u + 1
				],
				[
					c + 1,
					l + 1,
					u
				],
				[
					c,
					l + 1,
					u
				]
			], [
				0,
				1,
				0
			], c + .5, l + 1, u + .5), (h || _ || !n(c - 1, l, u)) && y("left", [
				[
					c,
					l,
					u + 1
				],
				[
					c,
					l,
					u
				],
				[
					c,
					l + 1,
					u
				],
				[
					c,
					l + 1,
					u + 1
				]
			], [
				-1,
				0,
				0
			], c, l + .5, u + .5), (h || _ || !n(c + 1, l, u)) && y("right", [
				[
					c + 1,
					l,
					u
				],
				[
					c + 1,
					l,
					u + 1
				],
				[
					c + 1,
					l + 1,
					u + 1
				],
				[
					c + 1,
					l + 1,
					u
				]
			], [
				1,
				0,
				0
			], c + 1, l + .5, u + .5), (h || _ || !n(c, l, u - 1)) && y("front", [
				[
					c,
					l,
					u
				],
				[
					c,
					l + 1,
					u
				],
				[
					c + 1,
					l + 1,
					u
				],
				[
					c + 1,
					l,
					u
				]
			], [
				0,
				0,
				-1
			], c + .5, l + .5, u), (h || _ || !n(c, l, u + 1)) && y("back", [
				[
					c + 1,
					l,
					u + 1
				],
				[
					c + 1,
					l + 1,
					u + 1
				],
				[
					c,
					l + 1,
					u + 1
				],
				[
					c,
					l,
					u + 1
				]
			], [
				0,
				0,
				1
			], c + .5, l + .5, u + 1), !t && a.length > f && this._faceCache3D.set(o, a.slice(f));
		}
		return this._dirtyKeys.clear(), a;
	}
	getFaces(e = {}) {
		if (e.raw) {
			if (this._cachedRawEpoch === this._epoch && this._cachedRawFaces) return this._cachedRawFaces;
			let e = this._buildFaces3D().filter((e) => e.type !== "content");
			return this._cachedRawFaces = e, this._cachedRawEpoch = this._epoch, e;
		}
		if (this._cachedEpoch === this._epoch && this._cachedFaces) return this._cachedFaces;
		let t = null;
		if (this.renderOptions.projection === "oblique") {
			let { depthOffsetX: e, depthOffsetY: n } = this.renderOptions;
			t = /* @__PURE__ */ new Set(), t.add("back"), n >= 0 && t.add("top"), n <= 0 && t.add("bottom"), e >= 0 && t.add("left"), e <= 0 && t.add("right");
		}
		let n = this._projectAndSort(this._buildFaces3D(t));
		return this._cachedFaces = n, this._cachedEpoch = this._epoch, n;
	}
	renderTest(t) {
		let n = t.regions || [t.bounds], r = t.test, i = t.gap === void 0 ? this.defaultGap : t.gap, a = typeof t.style == "function" ? t.style : null, o = a ? null : t.style || null, s = this.defaultStyle, { projection: c, depthOffsetX: l, depthOffsetY: u, tileW: d, tileH: f } = this.renderOptions, p = c === "oblique" ? l / d : 0, m = c === "oblique" ? u / f : 0, h = c === "oblique", g = [], _ = n.length > 1 ? /* @__PURE__ */ new Set() : null, v = !a && !o;
		for (let [[t, c, d], [f, y, b]] of n) for (let n = d; n < b; n++) for (let d = c; d < y; d++) for (let c = t; c < f; c++) {
			if (_) {
				let e = c + 512 << 20 | d + 512 << 10 | n + 512;
				if (_.has(e)) continue;
				_.add(e);
			}
			if (!r(c, d, n)) continue;
			let t = {
				x: c,
				y: d,
				z: n
			}, f = v ? () => s : (e) => {
				if (a) return {
					...s,
					...a(c, d, n, e)
				};
				let t = o.default, r = t ? {
					...s,
					...typeof t == "function" ? t(c, d, n) : t
				} : s, i = o[e];
				return i ? {
					...r,
					...typeof i == "function" ? i(c, d, n) : i
				} : r;
			};
			if (h) {
				let a = (e, t, n) => n - e * p - t * m, o = (r, o, s, l, u) => {
					let p = i ? e._scaleVertices(o, c, d, n, [
						1 - 2 * i,
						1 - 2 * i,
						1 - 2 * i
					], [
						.5,
						.5,
						.5
					]) : o;
					g.push({
						type: r,
						voxel: t,
						vertices: p,
						depth: a(s, l, u),
						style: f(r)
					});
				};
				u < 0 && !r(c, d - 1, n) && o("top", [
					[
						c,
						d,
						n
					],
					[
						c + 1,
						d,
						n
					],
					[
						c + 1,
						d,
						n + 1
					],
					[
						c,
						d,
						n + 1
					]
				], c + .5, d, n + .5), u > 0 && !r(c, d + 1, n) && o("bottom", [
					[
						c,
						d + 1,
						n + 1
					],
					[
						c + 1,
						d + 1,
						n + 1
					],
					[
						c + 1,
						d + 1,
						n
					],
					[
						c,
						d + 1,
						n
					]
				], c + .5, d + 1, n + .5), l < 0 && !r(c - 1, d, n) && o("left", [
					[
						c,
						d,
						n + 1
					],
					[
						c,
						d,
						n
					],
					[
						c,
						d + 1,
						n
					],
					[
						c,
						d + 1,
						n + 1
					]
				], c, d + .5, n + .5), l > 0 && !r(c + 1, d, n) && o("right", [
					[
						c + 1,
						d,
						n
					],
					[
						c + 1,
						d,
						n + 1
					],
					[
						c + 1,
						d + 1,
						n + 1
					],
					[
						c + 1,
						d + 1,
						n
					]
				], c + 1, d + .5, n + .5), r(c, d, n - 1) || o("front", [
					[
						c,
						d,
						n
					],
					[
						c,
						d + 1,
						n
					],
					[
						c + 1,
						d + 1,
						n
					],
					[
						c + 1,
						d,
						n
					]
				], c + .5, d + .5, n);
			} else {
				let a = (r, a, o, s) => {
					let l = a, u = s;
					if (i) {
						let t = 1 - 2 * i;
						l = e._scaleVertices(a, c, d, n, [
							t,
							t,
							t
						], [
							.5,
							.5,
							.5
						]);
						let r = c + .5, o = d + .5, f = n + .5;
						u = [
							r + (s[0] - r) * t,
							o + (s[1] - o) * t,
							f + (s[2] - f) * t
						];
					}
					g.push({
						type: r,
						voxel: t,
						vertices: l,
						n: o,
						c: u,
						style: f(r)
					});
				};
				r(c, d - 1, n) || a("top", [
					[
						c,
						d,
						n
					],
					[
						c + 1,
						d,
						n
					],
					[
						c + 1,
						d,
						n + 1
					],
					[
						c,
						d,
						n + 1
					]
				], [
					0,
					-1,
					0
				], [
					c + .5,
					d,
					n + .5
				]), r(c, d + 1, n) || a("bottom", [
					[
						c,
						d + 1,
						n + 1
					],
					[
						c + 1,
						d + 1,
						n + 1
					],
					[
						c + 1,
						d + 1,
						n
					],
					[
						c,
						d + 1,
						n
					]
				], [
					0,
					1,
					0
				], [
					c + .5,
					d + 1,
					n + .5
				]), r(c - 1, d, n) || a("left", [
					[
						c,
						d,
						n + 1
					],
					[
						c,
						d,
						n
					],
					[
						c,
						d + 1,
						n
					],
					[
						c,
						d + 1,
						n + 1
					]
				], [
					-1,
					0,
					0
				], [
					c,
					d + .5,
					n + .5
				]), r(c + 1, d, n) || a("right", [
					[
						c + 1,
						d,
						n
					],
					[
						c + 1,
						d,
						n + 1
					],
					[
						c + 1,
						d + 1,
						n + 1
					],
					[
						c + 1,
						d + 1,
						n
					]
				], [
					1,
					0,
					0
				], [
					c + 1,
					d + .5,
					n + .5
				]), r(c, d, n - 1) || a("front", [
					[
						c,
						d,
						n
					],
					[
						c,
						d + 1,
						n
					],
					[
						c + 1,
						d + 1,
						n
					],
					[
						c + 1,
						d,
						n
					]
				], [
					0,
					0,
					-1
				], [
					c + .5,
					d + .5,
					n
				]), r(c, d, n + 1) || a("back", [
					[
						c + 1,
						d,
						n + 1
					],
					[
						c + 1,
						d + 1,
						n + 1
					],
					[
						c,
						d + 1,
						n + 1
					],
					[
						c,
						d,
						n + 1
					]
				], [
					0,
					0,
					1
				], [
					c + .5,
					d + .5,
					n + 1
				]);
			}
		}
		return this._projectAndSort(g);
	}
	_projectPoint(e, t, n) {
		let { projection: r, tileW: i, tileH: a, depthOffsetX: o, depthOffsetY: s, cameraX: c, cameraY: l, cameraDistance: u } = this.renderOptions, d = (e) => Math.round(e * 1e4) / 1e4;
		if (r === "oblique") return {
			x: d(e * i + n * o),
			y: d(t * a + n * s)
		};
		if (r === "orthographic" || r === "isometric") {
			let { angle: r = 0, pitch: o = 0 } = this.renderOptions, s = Math.cos(r), c = Math.sin(r), l = Math.cos(o), u = Math.sin(o), f = e * s - n * c, p = t * l - (e * c + n * s) * u;
			return {
				x: d((f + 5) * i),
				y: d((p + 5) * a)
			};
		}
		let f = u / (n + u);
		return {
			x: d((c + (e - c) * f) * i),
			y: d((l + (t - l) * f) * a)
		};
	}
	_projectAndSort(e) {
		let t = [], n = (e) => Math.round(e * 1e4) / 1e4, { projection: r, tileW: i, tileH: a, depthOffsetX: o, depthOffsetY: s, cameraX: c, cameraY: l } = this.renderOptions, u = r === "oblique" ? o / i : 0, d = r === "oblique" ? s / a : 0, { cameraDistance: f } = this.renderOptions;
		for (let p of e) {
			if (p.type === "content") {
				let [e, m, h] = p._pos, g, _, v, y;
				if (r === "oblique") g = n((e + .5) * i + (h + .5) * o), _ = n((m + .5) * a + (h + .5) * s), v = 1, y = h + .5 - (e + .5) * u - (m + .5) * d;
				else if (r === "orthographic" || r === "isometric") {
					let { angle: t = 0, pitch: r = 0 } = this.renderOptions, o = Math.cos(t), s = Math.sin(t), c = Math.cos(r), l = Math.sin(r), u = (e + .5) * o - (h + .5) * s, d = (m + .5) * c - ((e + .5) * s + (h + .5) * o) * l;
					g = n((u + 5) * i), _ = n((d + 5) * a), v = 1, y = (m + .5) * l + ((e + .5) * s + (h + .5) * o) * c;
				} else {
					let t = f / (h + .5 + f);
					g = n((c + (e + .5 - c) * t) * i), _ = n((l + (m + .5 - l) * t) * a), v = n(t);
					let r = e + .5 - c, o = m + .5 - l, s = h + .5 + f;
					y = r * r + o * o + s * s;
				}
				let x = [
					[
						e,
						m,
						h
					],
					[
						e + 1,
						m,
						h
					],
					[
						e,
						m + 1,
						h
					],
					[
						e + 1,
						m + 1,
						h
					]
				];
				if (r === "oblique") {
					let e = [];
					for (let [t, r, c] of x) e.push(n(t * i + c * o), n(r * a + c * s));
					p.points = new b(e);
				} else if (r === "orthographic" || r === "isometric") {
					let e = [], { angle: t = 0, pitch: r = 0 } = this.renderOptions, o = Math.cos(t), s = Math.sin(t), c = Math.cos(r), l = Math.sin(r);
					for (let [t, r, u] of x) {
						let d = t * o - u * s, f = r * c - (t * s + u * o) * l;
						e.push(n((d + 5) * i), n((f + 5) * a));
					}
					p.points = new b(e);
				} else {
					let e = [];
					for (let [t, r, o] of x) {
						let s = f / (o + f);
						e.push(n((c + (t - c) * s) * i), n((l + (r - l) * s) * a));
					}
					p.points = new b(e);
				}
				p.depth = y, p._px = g, p._py = _, p._scale = v, t.push(p);
				continue;
			}
			if (r === "oblique") {
				if (p.type === "back" || p.type === "top" && s >= 0 || p.type === "bottom" && s <= 0 || p.type === "left" && o >= 0 || p.type === "right" && o <= 0) continue;
				p.depth = p.c[2] - p.c[0] * u - p.c[1] * d;
				let e = [];
				for (let t of p.vertices) e.push(n(t[0] * i + t[2] * o), n(t[1] * a + t[2] * s));
				p.points = new b(e);
			} else if (r === "orthographic" || r === "isometric") {
				let { angle: e = 0, pitch: t = 0 } = this.renderOptions, r = Math.cos(e), o = Math.sin(e), s = Math.cos(t), c = Math.sin(t), l = [
					o * s,
					c,
					r * s
				];
				if (l[0] * p.n[0] + l[1] * p.n[1] + l[2] * p.n[2] >= 0) continue;
				let u = [];
				for (let e of p.vertices) {
					let t = e[0] * r - e[2] * o, l = e[1] * s - (e[0] * o + e[2] * r) * c;
					u.push(n((t + 5) * i), n((l + 5) * a));
				}
				p.points = new b(u), p.depth = p.c[1] * c + (p.c[0] * o + p.c[2] * r) * s;
			} else if (r === "perspective") {
				let e = c, t = l, r = -f, o = [
					p.c[0] - e,
					p.c[1] - t,
					p.c[2] - r
				];
				if (o[0] * p.n[0] + o[1] * p.n[1] + o[2] * p.n[2] >= 0 || p.vertices.some((e) => e[2] + f < .01)) continue;
				let s = [];
				for (let r of p.vertices) {
					let o = f / (r[2] + f);
					s.push(n((e + (r[0] - e) * o) * i), n((t + (r[1] - t) * o) * a));
				}
				p.points = new b(s), p.depth = o[0] * o[0] + o[1] * o[1] + o[2] * o[2];
			}
			t.push(p);
		}
		return t.sort((e, t) => t.depth - e.depth || e.voxel.x - t.voxel.x || e.voxel.y - t.voxel.y || e.voxel.z - t.voxel.z || e.type.localeCompare(t.type)), t;
	}
	getBounds(e = 0, t) {
		t ||= this.getFaces();
		let n = v(t);
		return {
			x: n.x - e,
			y: n.y - e,
			w: n.w + e * 2,
			h: n.h + e * 2,
			faces: t
		};
	}
	getVoxelInfo(e) {
		let t = Array.isArray(e) ? this.getVoxel(e) : e;
		if (!t) return {
			voxel: null,
			center3D: null,
			center2D: null,
			bounds2D: null,
			normalizedCenter2D: null,
			normalizedSize2D: null
		};
		let { x: n, y: r, z: i } = t, a = n + .5, o = r + .5, s = i + .5, c = [
			a,
			o,
			s
		], l = this._projectPoint(a, o, s), u = this.getFaces(), d = Infinity, f = Infinity, p = -Infinity, m = -Infinity, h = !1;
		for (let e = 0; e < u.length; e++) {
			let n = u[e];
			if (n.voxel !== t) continue;
			let r = n.points.data;
			for (let e = 0; e < r.length; e += 2) {
				let t = r[e], n = r[e + 1];
				t < d && (d = t), n < f && (f = n), t > p && (p = t), n > m && (m = n);
			}
			h = !0;
		}
		let g = h ? {
			x: d,
			y: f,
			w: p - d,
			h: m - f
		} : null, _ = v(u);
		return {
			voxel: t,
			center3D: c,
			center2D: l,
			bounds2D: g,
			normalizedCenter2D: _.w > 0 && _.h > 0 ? {
				x: (l.x - _.x) / _.w,
				y: (l.y - _.y) / _.h
			} : null,
			normalizedSize2D: g && _.w > 0 && _.h > 0 ? {
				w: g.w / _.w,
				h: g.h / _.h
			} : null
		};
	}
	findByPosition(e, t = {}) {
		let n = t.offset, r = n ? e[0] + n[0] : e[0], i = n ? e[1] + n[1] : e[1], a = this.getFaces();
		for (let e = a.length - 1; e >= 0; e--) {
			let t = a[e];
			if (t.type !== "content" && T(r, i, t.points)) return {
				voxel: t.voxel,
				face: t
			};
		}
		return null;
	}
	toSVG(e = {}) {
		this._svgRenderer ||= new _();
		let t = e.faces || this.getFaces();
		return this._svgRenderer.render(t, {
			...e,
			tileW: this.renderOptions.tileW,
			decals: this.decals
		});
	}
};
//#endregion
export { D as Heerich, _ as SVGRenderer, x as boxCoords, w as fillCoords, C as lineCoords, S as sphereCoords };
