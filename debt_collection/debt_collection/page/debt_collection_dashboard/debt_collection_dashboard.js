frappe.pages["debt-collection-dashboard"].on_page_load = function (wrapper) {
	frappe.dc_dashboard = new DebtCollectionDashboard(wrapper);
};

class DebtCollectionDashboard {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: "Recovery Dashboard",
			single_column: true,
		});
		this.collector_filter = null;
		this.setup_collector_filter();
		this.render_skeleton();
		this.load_data();
	}

	setup_collector_filter() {
		this.page.set_secondary_action("Refresh", () => this.load_data(), "refresh");
		frappe.call({
			method: "debt_collection.debt_collection.api.debt_api.get_collectors",
			callback: (r) => {
				if (!r.message) return;
				const collectors = [{ value: "", label: "All Collectors" }, ...r.message.map(c => ({ value: c.name, label: c.full_name }))];
				this.$collector = this.page.add_field({
					fieldtype: "Select",
					fieldname: "collector",
					label: "Collector",
					options: collectors.map(c => c.label).join("\n"),
					change: () => this.load_data(),
				});
			},
		});
	}

	render_skeleton() {
		$(this.page.body).html(`
			<div class="dc-dashboard" style="padding:20px;">
				<div id="dc-summary-cards" class="dc-summary-row"></div>
				<div id="dc-aging-cards" class="dc-aging-row" style="margin-top:16px;"></div>
				<div class="dc-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:24px;">
					<div id="dc-priority" class="dc-card"></div>
					<div id="dc-activity" class="dc-card"></div>
				</div>
			</div>
		`);
	}

	load_data() {
		const collector = this.$collector ? this.$collector.get_value() : null;
		frappe.call({
			method: "debt_collection.debt_collection.api.debt_api.get_dashboard_summary",
			args: { collector: collector || null },
			freeze: true,
			freeze_message: "Loading Dashboard...",
			callback: (r) => {
				if (!r.message) return;
				this.render(r.message);
			},
		});
	}

	render(data) {
		const { summary, top_customers, recent_activity } = data;
		const fmt = (v) => format_currency(v, "KES");

		// Summary cards
		$("#dc-summary-cards").html(`
			<div class="dc-stat-card primary">
				<div class="dc-stat-icon">💰</div>
				<div class="dc-stat-label">Total Outstanding Balance</div>
				<div class="dc-stat-value">${fmt(summary.total_outstanding)}</div>
			</div>
			<div class="dc-stat-card warning">
				<div class="dc-stat-icon">📋</div>
				<div class="dc-stat-label">Total PDC (Cheques Incoming)</div>
				<div class="dc-stat-value">${fmt(summary.total_pdc)}</div>
			</div>
			<div class="dc-stat-card success">
				<div class="dc-stat-icon">✅</div>
				<div class="dc-stat-label">Total Net Outstanding</div>
				<div class="dc-stat-value">${fmt(summary.net_outstanding)}</div>
			</div>
		`);

		// Ageing cards
		const ageing = [
			{ label: "Under 30 Days", value: summary.under_30, color: "#38a169" },
			{ label: "Over 30 Days", value: summary.over_30, color: "#d69e2e" },
			{ label: "Over 60 Days", value: summary.over_60, color: "#dd6b20" },
			{ label: "Over 90 Days", value: summary.over_90, color: "#e53e3e" },
			{ label: "Over 120 Days", value: summary.over_120, color: "#9b2c2c" },
		];
		$("#dc-aging-cards").html(ageing.map(a => `
			<div class="dc-aging-card" style="border-top: 4px solid ${a.color}">
				<div class="dc-aging-label">${a.label}</div>
				<div class="dc-aging-value" style="color:${a.color}">${fmt(a.value || 0)}</div>
			</div>
		`).join(""));

		// Priority list
		const priority_rows = (top_customers || []).map((c, i) => `
			<div class="dc-priority-row" onclick="frappe.set_route('outstanding-invoices', {customer: '${c.customer}'})">
				<div>
					<div class="dc-priority-name">${c.customer_name || c.customer}</div>
					<div class="dc-priority-sub">${c.customer}</div>
				</div>
				<div style="text-align:right;">
					<div style="color:#e53e3e;font-weight:700;">${fmt(c.outstanding_amount)}</div>
					<div class="dc-priority-sub">${c.invoice_count} Open Invoices</div>
				</div>
			</div>
		`).join("");

		$("#dc-priority").html(`
			<div class="dc-card-header">
				<span>Collection Priority</span>
				<button class="dc-btn-sm" onclick="frappe.set_route('outstanding-invoices')">View All</button>
			</div>
			${priority_rows || "<p style='color:#a0aec0;padding:16px;'>No outstanding invoices.</p>"}
		`);

		// Recent activity
		const activity_rows = (recent_activity || []).map(a => `
			<div class="dc-activity-row">
				<div class="dc-activity-avatar">${(a.customer_name || "?")[0]}</div>
				<div class="dc-activity-body">
					<div class="dc-activity-name">${a.customer_name || a.customer}</div>
					<div class="dc-activity-method">${a.contact_method}</div>
					<div class="dc-activity-remarks">${(a.remarks || "").substring(0, 80)}${(a.remarks || "").length > 80 ? "..." : ""}</div>
					<div class="dc-activity-date">${frappe.datetime.str_to_user(a.created_date)}</div>
				</div>
			</div>
		`).join("");

		$("#dc-activity").html(`
			<div class="dc-card-header"><span>Recent Activity</span></div>
			${activity_rows || "<p style='color:#a0aec0;padding:16px;'>No recent activity.</p>"}
		`);
	}
}
