frappe.pages["active-plans"].on_page_load = function (wrapper) {
	frappe.active_plans = new ActivePlansPage(wrapper);
};

frappe.pages["active-plans"].on_page_show = function () {
	if (frappe.active_plans) frappe.active_plans.load();
};

class ActivePlansPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: "Active Collection Plans",
			single_column: true,
		});
		this._setup_toolbar();
		this._render_skeleton();
		this.load();
	}

	_setup_toolbar() {
		this.page.set_primary_action("Refresh", () => this.load(), "refresh");
		this.page.set_secondary_action("New Plan", () => {
			frappe.new_doc("Weekly Collection Plan");
		}, "add");
	}

	_render_skeleton() {
		$(this.page.body).html(`
			<div style="padding:20px;">
				<div id="ap-summary" style="margin-bottom:20px;"></div>
				<div id="ap-plans"></div>
			</div>
		`);

		// Expand / collapse customer table inside a plan card
		$(this.page.body).on("click", ".ap-plan-header", (e) => {
			if ($(e.target).closest("a,button,select").length) return;
			const card = $(e.currentTarget).closest(".ap-plan-card");
			card.find(".ap-plan-body").slideToggle(180);
			const ch = card.find(".ap-chevron");
			ch.text(ch.text() === "▼" ? "▲" : "▼");
		});

		// Customer name click → invoice drawer with follow-up
		$(this.page.body).on("click", ".ap-view-customer-btn", (e) => {
			e.stopPropagation();
			const btn        = $(e.currentTarget);
			const customer   = btn.data("customer");
			const plan_name  = btn.data("plan");
			if (!customer) return;
			frappe.call({
				method: "debt_collection.debt_collection.api.debt_api.get_customer_invoices",
				args: { customer },
				callback: (r) => {
					if (!r.message) return;
					dc_show_customer_invoices(customer, r.message.invoices, r.message.ageing, {
						show_follow_up: true,
						plan_name,
					});
				},
			});
		});
	}

	load() {
		frappe.call({
			method: "debt_collection.debt_collection.api.debt_api.get_active_plans",
			freeze: true,
			freeze_message: "Loading active plans...",
			callback: (r) => {
				if (!r.message) return;
				this._render_summary(r.message);
				this._render_plans(r.message);
			},
		});
	}

	// ── Summary bar ───────────────────────────────────────────────────────────
	_render_summary(plans) {
		const fmt = (v) => format_currency(v, "KES");
		const total_plans       = plans.length;
		const total_customers   = plans.reduce((s, p) => s + (p.customer_count || 0), 0);
		const total_outstanding = plans.reduce((s, p) => s + (parseFloat(p.total_outstanding) || 0), 0);
		const total_net         = plans.reduce((s, p) => s + (parseFloat(p.total_net_outstanding) || 0), 0);
		const total_planned     = plans.reduce((s, p) => s + (p.count_planned   || 0), 0);
		const total_completed   = plans.reduce((s, p) => s + (p.count_completed || 0), 0);

		const stats = [
			{ label: "Open Plans",         value: total_plans,           color: "#2b6cb0" },
			{ label: "Customers Scheduled",value: total_customers,       color: "#2d3748" },
			{ label: "Total Outstanding",  value: fmt(total_outstanding), color: "#e53e3e" },
			{ label: "Net Outstanding",    value: fmt(total_net),         color: "#2b6cb0" },
			{ label: "Planned",            value: total_planned,          color: "#d69e2e" },
			{ label: "Completed",          value: total_completed,        color: "#38a169" },
		];

		const stat_html = stats.map((s, i) => `
			<div style="flex:1;min-width:130px;padding:16px 20px;
			            ${i < stats.length - 1 ? "border-right:1px solid #edf2f7;" : ""}">
				<div style="font-size:11px;color:#718096;text-transform:uppercase;
				            letter-spacing:.5px;margin-bottom:4px;">${s.label}</div>
				<div style="font-size:20px;font-weight:700;color:${s.color};">${s.value}</div>
			</div>
		`).join("");

		$("#ap-summary").html(`
			<div style="display:flex;flex-wrap:wrap;background:#fff;border-radius:10px;
			            box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden;">
				${stat_html}
			</div>
		`);
	}

	// ── Plan cards ────────────────────────────────────────────────────────────
	_render_plans(plans) {
		if (!plans.length) {
			$("#ap-plans").html(`
				<div style="text-align:center;padding:48px;color:#a0aec0;font-size:14px;">
					No open collection plans.
					<br><br>
					<button onclick="frappe.new_doc('Weekly Collection Plan')"
					        style="padding:6px 16px;border:1px solid #cbd5e0;border-radius:4px;
					               background:#fff;color:#2b6cb0;font-size:13px;cursor:pointer;">
						+ Create Plan
					</button>
				</div>
			`);
			return;
		}

		const fmt = (v) => format_currency(v, "KES");

		const cards = plans.map(p => {
			const week_label = p.start_date
				? `${frappe.datetime.str_to_user(p.start_date)} → ${frappe.datetime.str_to_user(p.end_date)}`
				: p.name;

			const pct_done = p.customer_count > 0
				? Math.round((p.count_completed / p.customer_count) * 100)
				: 0;

			const prog_color = pct_done === 100 ? "#38a169" : pct_done > 50 ? "#d69e2e" : "#2b6cb0";

			const pill = (label, count, bg, fg) => count > 0 ? `
				<span style="background:${bg};color:${fg};padding:2px 10px;border-radius:10px;
				             font-size:11px;font-weight:600;">${label}: ${count}</span>
			` : "";

			// Customer select dropdown options — no longer needed (customers are directly clickable)


			// Customer rows in the expanded body
			const cust_rows = (p.customers || []).map(c => {
				const status_colors = {
					"Planned":   { bg: "#ebf8ff", fg: "#2b6cb0" },
					"Completed": { bg: "#c6f6d5", fg: "#276749" },
					"Skipped":   { bg: "#fed7d7", fg: "#c53030" },
				}[c.status] || { bg: "#edf2f7", fg: "#4a5568" };

				return `
					<tr style="transition:background .1s;"
					    onmouseover="this.style.background='#f7fafc'"
					    onmouseout="this.style.background='transparent'">
						<td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;
						           font-weight:600;">
							<button class="ap-view-customer-btn"
							        data-customer="${c.customer}"
							        data-plan="${p.name}"
							        style="background:none;border:none;color:#2b6cb0;cursor:pointer;
							               font-size:13px;font-weight:600;padding:0;text-align:left;">
								${c.customer_name || c.customer}
							</button>
						</td>
						<td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:12px;
						           color:#553c9a;">${c.sales_representative || "—"}</td>
						<td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:12px;
						           color:#718096;">${c.debt_collector || "—"}</td>
						<td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;
						           color:#e53e3e;font-weight:600;">${fmt(c.outstanding_amount)}</td>
						<td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;
						           color:#2b6cb0;font-weight:700;">${fmt(c.net_outstanding)}</td>
						<td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;
						           color:#718096;">${Math.round(c.avg_overdue_days || 0)}</td>
						<td style="padding:8px 12px;border-bottom:1px solid #edf2f7;">
							<span style="background:${status_colors.bg};color:${status_colors.fg};
							             padding:2px 8px;border-radius:10px;font-size:11px;
							             font-weight:600;">${c.status}</span>
						</td>
					</tr>
				`;
			}).join("");

			return `
				<div class="ap-plan-card" data-plan="${p.name}"
				     style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;
				            margin-bottom:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);">

					<!-- Header -->
					<div class="ap-plan-header"
					     style="display:flex;justify-content:space-between;align-items:center;
					            padding:16px 20px;cursor:pointer;gap:16px;">

						<div style="flex:1;min-width:0;">
							<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
								<a href="/app/weekly-collection-plan/${p.name}" target="_blank"
								   style="font-size:16px;font-weight:700;color:#2b6cb0;text-decoration:none;"
								   onclick="event.stopPropagation();">
									${p.name}
								</a>
								<span style="font-size:12px;color:#718096;">${week_label}</span>
							</div>
							<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
								${pill("Planned",   p.count_planned,   "#ebf8ff", "#2b6cb0")}
								${pill("Completed", p.count_completed, "#c6f6d5", "#276749")}
								${pill("Skipped",   p.count_skipped,   "#fed7d7", "#c53030")}
								<span style="font-size:12px;color:#718096;">
									${p.customer_count} customer${p.customer_count !== 1 ? "s" : ""}
								</span>
							</div>
						</div>

						<div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0;">
							<div style="display:flex;gap:20px;align-items:flex-end;">
								${[
									{ label: "Outstanding",    val: p.total_outstanding,     color: "#e53e3e" },
									{ label: "PDC",            val: p.total_pdc,             color: "#d69e2e" },
									{ label: "Net Outstanding",val: p.total_net_outstanding, color: "#2b6cb0", big: true },
								].map(a => `
									<div style="text-align:right;">
										<div style="font-size:10px;color:#a0aec0;text-transform:uppercase;
										            letter-spacing:.4px;">${a.label}</div>
										<div style="font-size:${a.big ? 16 : 13}px;font-weight:700;
										            color:${a.color};">${fmt(a.val || 0)}</div>
									</div>
								`).join("")}
							</div>
							<div style="width:180px;">
								<div style="display:flex;justify-content:space-between;
								            font-size:11px;color:#718096;margin-bottom:3px;">
									<span>Progress</span><span>${pct_done}%</span>
								</div>
								<div style="height:6px;background:#edf2f7;border-radius:3px;overflow:hidden;">
									<div style="width:${pct_done}%;height:100%;background:${prog_color};
									            border-radius:3px;transition:width .3s;"></div>
								</div>
							</div>
							<span class="ap-chevron" style="font-size:11px;color:#a0aec0;">▼</span>
						</div>
					</div>

					<!-- Body: customer table -->
					<div class="ap-plan-body"
					     style="display:none;border-top:1px solid #edf2f7;padding:0;background:#fafafa;">

						<div style="overflow-x:auto;">
							<table style="width:100%;border-collapse:collapse;font-size:13px;">
								<thead>
									<tr style="background:#f0f4f8;">
										${["Customer","Sales Rep","Collector","Outstanding",
										   "Net Outstanding","Avg Days","Status"].map(h => `
											<th style="padding:8px 12px;text-align:left;font-size:11px;
											           font-weight:600;color:#4a5568;
											           text-transform:uppercase;letter-spacing:.4px;
											           border-bottom:2px solid #e2e8f0;">${h}</th>
										`).join("")}
									</tr>
								</thead>
								<tbody>
									${cust_rows || `<tr><td colspan="7"
									    style="padding:16px;text-align:center;color:#a0aec0;">
									    No customers in this plan.</td></tr>`}
								</tbody>
							</table>
						</div>
						<div style="padding:12px 20px;border-top:1px solid #edf2f7;text-align:right;">
							<a href="/app/weekly-collection-plan/${p.name}" target="_blank"
							   style="font-size:13px;color:#2b6cb0;font-weight:600;">
								Open Plan to Update Status →
							</a>
						</div>
					</div>
				</div>
			`;
		}).join("");

		$("#ap-plans").html(cards);
	}
}
