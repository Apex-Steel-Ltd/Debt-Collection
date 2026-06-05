frappe.pages["salesperson-dashboard"].on_page_load = function (wrapper) {
	frappe.salesperson_dashboard = new SalespersonDashboard(wrapper);
};

frappe.pages["salesperson-dashboard"].on_page_show = function () {
	if (frappe.salesperson_dashboard) frappe.salesperson_dashboard.load();
};

class SalespersonDashboard {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: "Outstanding by Sales Person",
			single_column: true,
		});
		this.current_filter = "all";
		this._setup_toolbar();
		this._render_skeleton();
		this.load();
	}

	// ── Toolbar ───────────────────────────────────────────────────────────────
	_setup_toolbar() {
		this.page.set_primary_action("Refresh", () => this.load(), "refresh");
	}

	// ── Skeleton ──────────────────────────────────────────────────────────────
	_render_skeleton() {
		$(this.page.body).html(`
			<div style="padding:20px;">
				<div id="sp-tabs" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">
					${["all","over_120","over_90","over_60","over_30","current"].map(f => `
						<button
							data-filter="${f}"
							style="padding:6px 14px;border:1px solid ${f==="all"?"#2b6cb0":"#cbd5e0"};border-radius:20px;
							       background:${f==="all"?"#2b6cb0":"#fff"};color:${f==="all"?"#fff":"#4a5568"};
							       font-size:13px;cursor:pointer;font-weight:${f==="all"?600:400};"
							class="sp-tab"
						>${this._filter_label(f)}</button>
					`).join("")}
				</div>
				<div id="sp-grand"></div>
				<div id="sp-cards" style="margin-top:20px;"></div>
			</div>
		`);

		$(this.page.body).on("click", ".sp-tab", (e) => {
			// Reset all tabs
			$(this.page.body).find(".sp-tab").each((_, el) => {
				$(el).css({ background: "#fff", color: "#4a5568", borderColor: "#cbd5e0", fontWeight: 400 });
			});
			// Activate clicked
			$(e.currentTarget).css({ background: "#2b6cb0", color: "#fff", borderColor: "#2b6cb0", fontWeight: 600 });
			this.current_filter = $(e.currentTarget).data("filter");
			this.load();
		});

		// Expand/collapse card body
		$(this.page.body).on("click", ".sp-card-header", (e) => {
			if ($(e.target).hasClass("sp-view-all")) return;
			const card = $(e.currentTarget).closest(".sp-card");
			card.find(".sp-card-body").slideToggle(180);
			const chevron = card.find(".sp-chevron");
			chevron.text(chevron.text() === "▼" ? "▲" : "▼");
		});

		$(this.page.body).on("click", ".sp-view-all", (e) => {
			e.stopPropagation();
			const sp = $(e.currentTarget).data("sp");
			frappe.set_route("outstanding-invoices", { sales_person: sp });
		});
	}

	// ── Load ──────────────────────────────────────────────────────────────────
	load() {
		frappe.call({
			method: "debt_collection.debt_collection.api.debt_api.get_salesperson_dashboard",
			args: { ageing_filter: this.current_filter === "all" ? null : this.current_filter },
			freeze: true,
			freeze_message: "Loading...",
			callback: (r) => {
				if (!r.message) return;
				this._render_grand(r.message.grand);
				this._render_cards(r.message.data);
			},
		});
	}

	// ── Grand totals bar ──────────────────────────────────────────────────────
	_render_grand(g) {
		const fmt = (v) => format_currency(v, "KES");
		const stats = [
			{ label: "Total Outstanding",  value: fmt(g.outstanding_amount), color: "#e53e3e" },
			{ label: "PDC",                value: fmt(g.pdc_amount),         color: "#d69e2e" },
			{ label: "Net Outstanding",    value: fmt(g.net_outstanding),    color: "#2b6cb0" },
			{ label: "14% Interest Loss",  value: fmt(g.interest_loss),      color: "#9b2c2c" },
			{ label: "Customers",          value: g.customer_count,          color: "#2d3748" },
			{ label: "Invoices",           value: g.invoice_count,           color: "#2d3748" },
		];

		const cards = stats.map((s, i) => `
			<div style="flex:1;min-width:140px;padding:16px 20px;
			            ${i < stats.length - 1 ? "border-right:1px solid #edf2f7;" : ""}">
				<div style="font-size:11px;color:#718096;text-transform:uppercase;
				            letter-spacing:.5px;margin-bottom:4px;">${s.label}</div>
				<div style="font-size:18px;font-weight:700;color:${s.color};">${s.value}</div>
			</div>
		`).join("");

		$("#sp-grand").html(`
			<div style="display:flex;flex-wrap:wrap;background:#fff;border-radius:10px;
			            box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden;">
				${cards}
			</div>
		`);
	}

	// ── Salesperson cards ─────────────────────────────────────────────────────
	_render_cards(rows) {
		if (!rows || !rows.length) {
			$("#sp-cards").html(`
				<div style="text-align:center;padding:48px;color:#a0aec0;font-size:14px;">
					No outstanding invoices found.
				</div>
			`);
			return;
		}

		const fmt   = (v) => format_currency(v, "KES");
		const total = rows.reduce((s, r) => s + (parseFloat(r.outstanding_amount) || 0), 0);

		const cards = rows.map(r => {
			const share     = total > 0 ? ((parseFloat(r.outstanding_amount) || 0) / total * 100).toFixed(1) : 0;
			const avg_days  = Math.round(parseFloat(r.avg_overdue_days) || 0);
			const bar_color = avg_days > 90 ? "#e53e3e" : avg_days > 30 ? "#dd6b20" : "#38a169";

			// Ageing buckets
			const buckets = [
				{ label: "Current",     val: r.bucket_current,   color: "#38a169" },
				{ label: "1–30 Days",   val: r.bucket_30,        color: "#68d391" },
				{ label: "31–60 Days",  val: r.bucket_60,        color: "#d69e2e" },
				{ label: "61–90 Days",  val: r.bucket_90,        color: "#dd6b20" },
				{ label: "91–120 Days", val: r.bucket_120,       color: "#e53e3e" },
				{ label: ">120 Days",   val: r.bucket_over_120,  color: "#9b2c2c" },
			];
			const bucket_html = `
				<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px;">
					${buckets.map(b => `
						<div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;
						            padding:10px 14px;min-width:120px;flex:1;">
							<div style="font-size:11px;color:#718096;margin-bottom:3px;">${b.label}</div>
							<div style="font-size:14px;font-weight:700;color:${b.color};">${fmt(b.val || 0)}</div>
						</div>
					`).join("")}
				</div>
			`;

			// Top customers
			const cust_rows = (r.top_customers || []).map(c => `
				<div style="display:flex;justify-content:space-between;align-items:center;
				            padding:8px 0;border-bottom:1px solid #edf2f7;">
					<div>
						<div style="font-size:13px;font-weight:600;color:#2d3748;">${c.customer_name || c.customer}</div>
						<div style="font-size:11px;color:#a0aec0;margin-top:2px;">
							${c.invoice_count} invoice${c.invoice_count !== 1 ? "s" : ""}
						</div>
					</div>
					<div style="font-weight:700;color:#e53e3e;font-size:13px;">${fmt(c.outstanding_amount)}</div>
				</div>
			`).join("");

			return `
				<div class="sp-card" style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;
				                            margin-bottom:12px;overflow:hidden;
				                            box-shadow:0 1px 3px rgba(0,0,0,.06);">

					<!-- Header (always visible, click to expand) -->
					<div class="sp-card-header"
					     style="display:flex;justify-content:space-between;align-items:center;
					            padding:16px 20px;cursor:pointer;gap:16px;transition:background .12s;">

						<!-- Left: name + meta -->
						<div style="flex:1;min-width:0;">
							<div style="font-size:16px;font-weight:700;color:#2d3748;margin-bottom:4px;">
								${r.sales_person}
							</div>
							<div style="display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:#718096;">
								<span>${r.customer_count} customer${r.customer_count !== 1 ? "s" : ""}</span>
								<span>${r.invoice_count} invoice${r.invoice_count !== 1 ? "s" : ""}</span>
								<span style="color:${bar_color};font-weight:600;">
									Avg ${avg_days} days overdue
								</span>
								<span>${share}% of total</span>
							</div>
						</div>

						<!-- Right: amounts + share bar + chevron -->
						<div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0;">
							<div style="display:flex;gap:24px;align-items:flex-end;">
								${[
									{ label: "Outstanding",    val: r.outstanding_amount, color: "#e53e3e" },
									{ label: "PDC",            val: r.pdc_amount,         color: "#d69e2e" },
									{ label: "Net Outstanding",val: r.net_outstanding,    color: "#2b6cb0", big: true },
									{ label: "Interest Loss",  val: r.interest_loss,      color: "#9b2c2c" },
								].map(a => `
									<div style="text-align:right;">
										<div style="font-size:10px;color:#a0aec0;text-transform:uppercase;
										            letter-spacing:.4px;">${a.label}</div>
										<div style="font-size:${a.big ? 16 : 14}px;font-weight:700;
										            color:${a.color};">${fmt(a.val)}</div>
									</div>
								`).join("")}
							</div>
							<!-- proportional share bar -->
							<div style="width:200px;height:4px;background:#edf2f7;border-radius:2px;overflow:hidden;">
								<div style="width:${share}%;height:100%;background:${bar_color};border-radius:2px;
								            transition:width .3s;"></div>
							</div>
							<span class="sp-chevron" style="font-size:11px;color:#a0aec0;">▼</span>
						</div>
					</div>

					<!-- Body (hidden, toggled on header click) -->
					<div class="sp-card-body"
					     style="display:none;border-top:1px solid #edf2f7;padding:16px 20px;background:#fafafa;">
						${bucket_html}
						<div style="border-top:1px solid #edf2f7;padding-top:14px;">
							<div style="display:flex;justify-content:space-between;
							            align-items:center;margin-bottom:10px;">
								<div style="font-weight:600;font-size:13px;color:#4a5568;">Top Customers</div>
								<button class="sp-view-all" data-sp="${r.sales_person}"
								        style="padding:4px 12px;border:1px solid #cbd5e0;border-radius:4px;
								               background:#fff;color:#2b6cb0;font-size:12px;cursor:pointer;">
									View All →
								</button>
							</div>
							${cust_rows || '<div style="color:#a0aec0;font-size:13px;padding:8px 0;">No customers.</div>'}
						</div>
					</div>
				</div>
			`;
		}).join("");

		$("#sp-cards").html(cards);
	}

	// ── Helpers ───────────────────────────────────────────────────────────────
	_filter_label(f) {
		return {
			all: "All", over_120: "Over 120 Days", over_90: "Over 90 Days",
			over_60: "Over 60 Days", over_30: "Over 30 Days", current: "Current",
		}[f];
	}
}
