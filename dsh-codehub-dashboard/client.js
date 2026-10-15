// CodeHub contributes to DSH's native left navigation and main panel.
window.__ModuleLoader__.load({
	id: "dsh-codehub-dashboard",
	factory: (require) => {
		const react = require("react");
		const PANEL_ID = "codehub:dashboard";
		const inject = ["slots", "layout", "uiWorkspace"];
		const tagId = "dsh-codehub-dashboard/style";
		if (typeof document !== "undefined" && !document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]")) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = tagId;
			tag.textContent = ".chd-view{height:100%;display:flex;flex-direction:column;min-height:0;background:var(--dsw-alias-bg-base,#0d1117)}.chd-frame{flex:1;width:100%;border:0;display:block;min-height:0;background:transparent}";
			document.head.appendChild(tag);
		}

		// Native sidebar icons receive {size, selected}, not a numeric argument.
		function CodeHubIcon({ size = 16 } = {}) {
			const s = typeof size === "number" && size > 0 ? size : 16;
			return react.createElement("svg", { width: s, height: s, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", focusable: "false" },
				react.createElement("circle", { cx: "4.5", cy: "3.5", r: "2", stroke: "currentColor", strokeWidth: "1.4" }),
				react.createElement("circle", { cx: "4.5", cy: "12.5", r: "2", stroke: "currentColor", strokeWidth: "1.4" }),
				react.createElement("circle", { cx: "12", cy: "8", r: "2", stroke: "currentColor", strokeWidth: "1.4" }),
				react.createElement("path", { d: "M4.5 5.5v5M4.5 9.2c0-2.2 1.3-3 5.6-3.5M9.4 3.9l1.3 1.9 2-.8", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" })
			);
		}

		function validRequest(m) {
			if (!m || typeof m !== "object" || Array.isArray(m) || m.type !== "codehub:request") return false;
			if (typeof m.id !== "string" || !/^[\w-]{1,128}$/.test(m.id)) return false;
			const keys = m.action === "open-session" ? ["type", "id", "action", "sessionId"] : ["type", "id", "action"];
			if (Object.keys(m).length !== keys.length || !Object.keys(m).every(k => keys.includes(k))) return false;
			if (m.action === "pick-directory") return true;
			return m.action === "open-session" && typeof m.sessionId === "string" && m.sessionId.length <= 512 && !!m.sessionId.trim() && !/[\x00-\x1f\x7f]/.test(m.sessionId);
		}

		function apply(ctx) {
			function CodeHubView() {
				const frame = react.useRef(null);
				const lifecycle = react.useRef(null);
				const announce = () => {
					// A new iframe document must not receive an old document's response.
					if (lifecycle.current) lifecycle.current.generation++;
					frame.current?.contentWindow?.postMessage({
						type: "codehub:host-ready", version: 1,
						openSession: typeof ctx.uiWorkspace?.openSession === "function",
						pickDirectory: typeof ctx.uiWorkspace?.pickDirectory === "function"
					}, location.origin);
				};
				react.useEffect(() => {
					const life = { active: true, generation: 0 };
					lifecycle.current = life;
					const seen = new Set();
					const receive = async (event) => {
						const source = frame.current?.contentWindow;
						if (!life.active || !source || event.origin !== location.origin || event.source !== source || !validRequest(event.data)) return;
						const m = event.data;
						if (seen.has(m.id) || seen.size >= 4096) return;
						seen.add(m.id);
						const generation = life.generation;
						const response = { type: "codehub:response", id: m.id, action: m.action };
						try {
							if (m.action === "open-session") {
								if (typeof ctx.uiWorkspace?.openSession !== "function") throw new Error("DSH 会话服务不可用");
								await ctx.uiWorkspace.openSession(m.sessionId);
							} else {
								if (typeof ctx.uiWorkspace?.pickDirectory !== "function") throw new Error("DSH 目录选择器不可用");
								const path = await ctx.uiWorkspace.pickDirectory();
								response.path = typeof path === "string" ? path : "";
							}
							response.ok = true;
						} catch (error) {
							response.ok = false;
							response.error = String(error?.message || "DSH 操作失败");
						}
						if (life.active && generation === life.generation && frame.current?.contentWindow === source) source.postMessage(response, location.origin);
					};
					window.addEventListener("message", receive);
					announce();
					return () => { life.active = false; window.removeEventListener("message", receive); seen.clear(); };
				}, []);
				return react.createElement("div", { className: "chd-view" },
					react.createElement("iframe", { ref: frame, className: "chd-frame", src: "/codehub/index.html", title: "CodeHub 看板", onLoad: announce })
				);
			}
			ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: PANEL_ID }, CodeHubView));
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: 45, label: () => "CodeHub" }, CodeHubIcon));
		}
		return { apply, inject };
	}
});
