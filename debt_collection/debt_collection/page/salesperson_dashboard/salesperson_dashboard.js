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
			<div class="dc-page">
				<!-- Ageing filter tabs -->
				<div class="dc-tab-bar" id="sp-tabs">
					${["all","over_120","over_90","over_60","over_30","current"].map(f => `
						<button class="dc-tab ${f === "all" ? "active" : ""}" data-filter="${f}">
							${this._filter_label(f)}
						</button>
					`).join("")}
				</div>

				<!-- Grand total summary bar -->
				<div id="sp-grand" style="margin-top:16px;"></div>

				<!-- Per-salesperson cards -->
				<div id="sp-cards" style="margin-top:20px;"></div>
			</div>
		`);

		$(this.page.body).on("click", ".dc-tab", (e) => {
			$(".dc-tab").removeClass("active");
			$(e.currentTarget).addClass("active");
			this.current_filter = $(e.currentTarget).data("filter");
			this.load();
		});

		// Expand / collapse customer list inside a card
		$(this.page.body).on("click", ".sp-card-header", (e) => {
			const card = $(e.currentTarget).closest(".sp-card");
			card.find(".sp-card-body").slideToggle(180);
			card.find(".sp-chevron").toggleClass("sp-chevron-open");
		});

		// "View All" drills into outstanding-invoices filtered by sales person
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
		$("#sp-grand").html(`
			<div class="sp-grand-bar">
				<div class="sp-grand-stat">
					<div class="sp-grand-lbl">Total Outstanding</div>
					<div class="sp-grand-val" style="color:#e53e3e;">${fmt(g.outstanding_amount)}</div>
				</div>
				<div class="sp-grand-stat">
					<div class="sp-grand-lbl">PDC</div>
					<div class="sp-grand-val" style="color:#d69e2e;">${fmt(g.pdc_amount)}</div>
				</div>
				<div class="sp-grand-stat">
					<div class="sp-grand-lbl">Net Outstanding</div>
					<div class="sp-grand-val" style="color:#2b6cb0;">${fmt(g.net_outstanding)}</div>
				</div>
				<div class="sp-grand-stat">
					<div class="sp-grand-lbl">14% Interest Loss</div>
					<div class="sp-grand-val" style="color:#9b2c2c;">${fmt(g.interest_loss)}</div>
				</div>
				<div class="sp-grand-stat">
					<div class="sp-grand-lbl">Customers</div>
					<div class="sp-grand-val">${g.customer_count}</div>
				</div>
				<div class="sp-grand-stat">
					<div class="sp-grand-lbl">Invoices</div>
					<div class="sp-grand-val">${g.invoice_count}</div>
				</div>
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
		const total = rows.reduce((s, r) => s + flt(r.outstanding_amount), 0);

		const cards = rows.map(r => {
			const share = total > 0 ? (flt(r.outstanding_amount) / total * 100).toFixed(1) : 0;
			const bar_color = flt(r.avg_overdue_days) > 90 ? "#e53e3e"
				: flt(r.avg_overdue_days) > 30 ? "#dd6b20" : "#38a169";

			const bucket_html = `
				<div class="sp-buckets">
					${this._bucket("Current",    r.bucket_current,  "#38a169")}
					${this._bucket("1–30 Days",  r.bucket_30,       "#68d391")}
					${this._bucket("31–60 Days", r.bucket_60,       "#d69e2e")}
					${this._bucket("61–90 Days", r.bucket_90,       "#dd6b20")}
					${this._bucket("91–120 Days",r.bucket_120,      "#e53e3e")}
					${this._bucket(">120 Days",  r.bucket_over_120, "#9b2c2c")}
				</div>
			`;

			const customer_rows = (r.top_customers || []).map(c => `
				<div class="sp-cust-row">
					<div>
						<div class="sp-cust-name">${c.customer_name || c.customer}</div>
						<div class="sp-cust-sub">${c.invoice_count} invoice${c.invoice_count !== 1 ? "s" : ""}</div>
					</div>
					<div style="text-align:right;">
						<div style="font-weight:700;color:#e53e3e;font-size:13px;">${fmt(c.outstanding_amount)}</div>
					</div>
				</div>
			`).join("");

			return `
				<div class="sp-card">
					<div class="sp-card-header">
						<div class="sp-card-header-left">
							<div class="sp-name">${r.sales_person}</div>
							<div class="sp-meta">
								<span>${r.customer_count} customer${r.customer_count !== 1 ? "s" : ""}</span>
								<span>${r.invoice_count} invoice${r.invoice_count !== 1 ? "s" : ""}</span>
								<span style="color:${bar_color};">Avg ${Math.round(r.avg_overdue_days || 0)} days overdue</span>
								<span style="color:#718096;">${share}% of total</span>
							</div>
						</div>
						<div class="sp-card-header-right">
							<div class="sp-card-amounts">
								<div class="sp-amt-block">
									<div class="sp-amt-lbl">Outstanding</div>
									<div class="sp-amt-val" style="color:#e53e3e;">${fmt(r.outstanding_amount)}</div>
								</div>
								<div class="sp-amt-block">
									<div class="sp-amt-lbl">PDC</div>
									<div class="sp-amt-val" style="color:#d69e2e;">${fmt(r.pdc_amount)}</div>
								</div>
								<div class="sp-amt-block">
									<div class="sp-amt-lbl">Net Outstanding</div>
									<div class="sp-amt-val" style="color:#2b6cb0;font-size:16px;">${fmt(r.net_outstanding)}</div>
								</div>
								<div class="sp-amt-block">
									<div class="sp-amt-lbl">Interest Loss</div>
									<div class="sp-amt-val" style="color:#9b2c2c;">${fmt(r.interest_loss)}</div>
								</div>
							</div>
							<!-- Share bar -->
							<div class="sp-share-bar-wrap">
								<div class="sp-share-bar" style="width:${share}%;background:${bar_color};"></div>
							</div>
							<div class="sp-chevron">▼</div>
						</div>
					</div>

					<div class="sp-card-body" style="display:none;">
						${bucket_html}
						<div class="sp-cust-section">
							<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
								<div style="font-weight:600;font-size:13px;color:#4a5568;">
									Top Customers
								</div>
								<button class="dc-btn-sm sp-view-all" data-sp="${r.sales_person}">
									View All →
								</button>
							</div>
							${customer_rows || '<div style="color:#a0aec0;font-size:13px;padding:8px 0;">No customers.</div>'}
						</div>
					</div>
				</div>
			`;
		}).join("");

		$("#sp-cards").html(cards);
	}

	// ── Helpers ───────────────────────────────────────────────────────────────
	_bucket(label, amount, color) {
		const fmt = (v) => format_currency(v, "KES");
		return `
			<div class="sp-bucket">
				<div class="sp-bucket-lbl">${label}</div>
				<div class="sp-bucket-val" style="color:${color};">${fmt(amount || 0)}</div>
			</div>
		`;
	}

	_filter_label(f) {
		return { all: "All", over_120: "Over 120 Days", over_90: "Over 90 Days",
			over_60: "Over 60 Days", over_30: "Over 30 Days", current: "Current" }[f];
	}
}

// polyfill flt for non-frappe contexts
function flt(v) { return parseFloat(v) || 0; }
