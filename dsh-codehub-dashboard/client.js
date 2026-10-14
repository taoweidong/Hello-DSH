// dsh-codehub-dashboard — client half
// Registers the "CodeHub" sidebar tab through the dsh-better-sidebar service
// (ctx.betterSidebar.registerTab). The tab renders the dashboard SPA served by
// the host half at /codehub/index.html. The tab badge shows the count of MRs
// waiting for my review, polled cheaply from /codehub/api?op=summary.
window.__ModuleLoader__.load({
	id: "dsh-codehub-dashboard",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		//#region styles
		const css = [
			".chd-view{height:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base, #0d1117);min-height:0}",
			".chd-frame{flex:1;width:100%;border:0;display:block;min-height:0;background:transparent}"
		].join("");
		const tagId = "dsh-codehub-dashboard/style";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-codehub-dashboard";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		/** Merge-request style icon drawn with currentColor (theme-token safe). */
		function CodeHubIcon(size) {
			const s = typeof size === "number" && size > 0 ? size : 16;
			return react.createElement("svg", {
				width: s, height: s, viewBox: "0 0 16 16", fill: "none",
				"aria-hidden": "true", focusable: "false"
			},
				react.createElement("circle", { cx: "4.5", cy: "3.5", r: "2", stroke: "currentColor", strokeWidth: "1.4" }),
				react.createElement("circle", { cx: "4.5", cy: "12.5", r: "2", stroke: "currentColor", strokeWidth: "1.4" }),
				react.createElement("circle", { cx: "12", cy: "8", r: "2", stroke: "currentColor", strokeWidth: "1.4" }),
				react.createElement("path", {
					d: "M4.5 5.5v5M4.5 9.2c0-2.2 1.3-3 5.6-3.5",
					stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", fill: "none"
				}),
				react.createElement("path", {
					d: "M9.4 3.9l1.3 1.9 2-.8",
					stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round", strokeLinejoin: "round", fill: "none"
				})
			);
		}

		const frameSrc = (scope) => {
			const sid = (scope && scope.sessionId) || "";
			const cwd = (scope && scope.cwd) || "";
			let src = "/codehub/index.html";
			const params = [];
			if (sid) params.push("sid=" + encodeURIComponent(sid));
			if (cwd) params.push("cwd=" + encodeURIComponent(cwd));
			if (params.length) src += "?" + params.join("&");
			return src;
		};

		/** The dashboard tab body: a full-height iframe hosting the SPA. */
		function CodeHubView(props) {
			return react.createElement("div", { className: "chd-view" },
				react.createElement("iframe", {
					className: "chd-frame",
					src: frameSrc(props.scope),
					title: "CodeHub 看板"
				})
			);
		}

		// Cached summary for the tab badge (badge() must stay cheap and sync).
		let summaryCache = null;

		const inject = ["betterSidebar"];

		function apply(ctx) {
			const svc = ctx.betterSidebar;
			if (!svc || typeof svc.registerTab !== "function") return; // service absent: stay inert

			// cheap summary polling for the badge (60s); failures are silent
			const poll = async () => {
				try {
					const r = await fetch("/codehub/api?op=summary", { headers: { accept: "application/json" } });
					if (!r.ok) return;
					const j = await r.json();
					if (j && j.ok && j.summary) summaryCache = j.summary;
				} catch { /* host half not ready yet */ }
			};
			poll();
			const timer = setInterval(poll, 60000);
			ctx.effect(() => () => clearInterval(timer));

			ctx.effect(() => svc.registerTab({
				id: "codehub:dashboard",
				title: () => "CodeHub",
				description: () => "CodeHub 仓库 MR / 检视意见聚合看板",
				icon: (size) => CodeHubIcon(size),
				order: 45,
				single: true,
				badge: () => {
					const n = summaryCache && Number(summaryCache.needsReview);
					return n > 0 ? n : null;
				},
				component: (props) => CodeHubView(props)
			}));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
