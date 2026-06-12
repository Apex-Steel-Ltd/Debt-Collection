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
		this.sp_filter = null;
		this._setup_toolbar();
		this._render_skeleton();
		this.load_data();
	}

	// ── Toolbar ───────────────────────────────────────────────────────────────
	_setup_toolbar() {
		this.page.set_secondary_action("Refresh", () => this.load_data(), "refresh");
		frappe.call({
			method: "debt_collection.debt_collection.api.debt_api.get_collectors",
			callback: (r) => {
				if (!r.message) return;
				const opts = [{ value: "", label: "All Collectors" },
					...r.message.map(c => ({ value: c.name, label: c.full_name }))];
				this.$collector = this.page.add_field({
					fieldtype: "Select", fieldname: "collector", label: "Collector",
					options: opts.map(c => c.label).join("\n"),
					change: () => this.load_data(),
				});
			},
		});
	}

	// ── Skeleton ──────────────────────────────────────────────────────────────
	_render_skeleton() {
		$(this.page.body).html(`
			<div style="padding:20px;">
				<div id="dc-summary-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;"></div>
				<div id="dc-aging-wrap" style="margin-top:20px;"></div>
				<div id="dc-pdc-aging-wrap" style="margin-top:20px;"></div>
				<div id="dc-je-wrap" style="margin-top:20px;"></div>
				<div id="dc-sp-wrap" style="margin-top:20px;"></div>
				<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:24px;">
					<div id="dc-priority" style="background:#fff;border-radius:10px;
					     box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden;"></div>
					<div id="dc-activity" style="background:#fff;border-radius:10px;
					     box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden;"></div>
				</div>
			</div>
		`);
	}

	// ── Load ──────────────────────────────────────────────────────────────────
	load_data() {
		const collector = this.$collector ? this.$collector.get_value() : null;
		frappe.call({
			method: "debt_collection.debt_collection.api.debt_api.get_dashboard_summary",
			args: { collector: collector || null },
			freeze: true, freeze_message: "Loading Dashboard...",
			callback: (r) => {
				if (!r.message) return;
				this.render(r.message);
			},
		});
	}

	// ── Render ────────────────────────────────────────────────────────────────
	render(data) {
		const { summary, top_customers, recent_activity, sp_summary } = data;
		const fmt = (v) => format_currency(v, "KES");

		// ── Summary cards ──────────────────────────────────────────────────────
		const cards = [
			{ icon: "💰", label: "Total Outstanding Balance", value: fmt(summary.total_outstanding), border: "#2b6cb0" },
			{ icon: "📋", label: "Total PDC (Cheques Incoming)", value: fmt(summary.total_pdc), border: "#d69e2e" },
			{ icon: "✅", label: "Total Net Outstanding", value: fmt(summary.net_outstanding), border: "#38a169" },
			{ icon: "⚠️", label: "JE Unreconciled", value: fmt(summary.je_unreconciled),
			  sub: `${summary.je_customer_count} customer(s) — <a href="/app/je-unreconciled" style="color:#c53030;font-size:11px;">View →</a>`,
			  border: "#e53e3e" },
		];
		$("#dc-summary-cards").html(cards.map(c => `
			<div style="background:#fff;border-radius:10px;padding:18px 20px;
			            box-shadow:0 1px 4px rgba(0,0,0,.08);border-left:4px solid ${c.border};">
				<div style="font-size:22px;">${c.icon}</div>
				<div style="font-size:12px;color:#718096;text-transform:uppercase;
				            letter-spacing:.5px;margin:4px 0 2px;">${c.label}</div>
				<div style="font-size:22px;font-weight:700;color:#2d3748;">${c.value}</div>
				${c.sub ? `<div style="font-size:12px;color:#e53e3e;margin-top:3px;">${c.sub}</div>` : ""}
			</div>
		`).join(""));

		// ── Invoice ageing ─────────────────────────────────────────────────────
		const ageing = [
			{ label: "Under 30 Days", value: summary.under_30, color: "#38a169" },
			{ label: "Over 30 Days",  value: summary.over_30,  color: "#d69e2e" },
			{ label: "Over 60 Days",  value: summary.over_60,  color: "#dd6b20" },
			{ label: "Over 90 Days",  value: summary.over_90,  color: "#e53e3e" },
			{ label: "Over 120 Days", value: summary.over_120, color: "#9b2c2c" },
		];
		$("#dc-aging-wrap").html(`
			<div style="font-size:12px;font-weight:600;color:#4a5568;text-transform:uppercase;
			            letter-spacing:.5px;margin-bottom:10px;">Outstanding Ageing</div>
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;">
				${ageing.map(a => `
					<div style="background:#fff;border-radius:8px;padding:14px 16px;
					            box-shadow:0 1px 3px rgba(0,0,0,.07);border-top:4px solid ${a.color};">
						<div style="font-size:12px;color:#718096;margin-bottom:4px;">${a.label}</div>
						<div style="font-size:18px;font-weight:700;color:${a.color};">${fmt(a.value || 0)}</div>
					</div>
				`).join("")}
			</div>
		`);

		// ── PDC ageing ─────────────────────────────────────────────────────────
		const pa = summary.pdc_ageing || {};
		const pdc_buckets = [
			{ label: "Within 7 Days",  value: pa.within_7,  color: "#38a169" },
			{ label: "8–14 Days",      value: pa.day_8_14,  color: "#68d391" },
			{ label: "15–30 Days",     value: pa.day_15_30, color: "#d69e2e" },
			{ label: "31–60 Days",     value: pa.day_31_60, color: "#dd6b20" },
			{ label: "Over 60 Days",   value: pa.over_60,   color: "#e53e3e" },
		];
		$("#dc-pdc-aging-wrap").html(`
			<div style="font-size:12px;font-weight:600;color:#4a5568;text-transform:uppercase;
			            letter-spacing:.5px;margin-bottom:10px;">PDC Maturity Ageing</div>
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;">
				${pdc_buckets.map(b => `
					<div style="background:#fff;border-radius:8px;padding:14px 16px;
					            box-shadow:0 1px 3px rgba(0,0,0,.07);border-top:4px solid ${b.color};">
						<div style="font-size:12px;color:#718096;margin-bottom:4px;">${b.label}</div>
						<div style="font-size:18px;font-weight:700;color:${b.color};">${fmt(b.value || 0)}</div>
					</div>
				`).join("")}
			</div>
		`);

		// ── JE unreconciled card ────────────────────────────────────────────────
		if (summary.je_unreconciled > 0) {
			$("#dc-je-wrap").html(`
				<div style="background:#fff5f5;border:1px solid #fed7d7;border-radius:8px;
				            padding:14px 18px;display:flex;justify-content:space-between;
				            align-items:center;">
					<div>
						<div style="font-weight:600;color:#c53030;font-size:14px;">
							⚠️ Journal Entry Credits Not Reconciled to Invoices
						</div>
						<div style="font-size:13px;color:#718096;margin-top:3px;">
							${summary.je_customer_count} customer(s) have JE credits that are not matched
							to any Sales Invoice. This reduces the Accounts Receivable balance
							but is not reflected in invoice outstanding amounts.
						</div>
					</div>
					<div style="text-align:right;flex-shrink:0;margin-left:20px;">
						<div style="font-size:20px;font-weight:700;color:#c53030;">${fmt(summary.je_unreconciled)}</div>
						<a href="/app/je-unreconciled"
						   style="font-size:12px;color:#2b6cb0;font-weight:600;">
							View Customers →
						</a>
					</div>
				</div>
			`);
		} else {
			$("#dc-je-wrap").empty();
		}

		// ── Sales Person Outstanding ────────────────────────────────────────────
		this._render_sp_section(sp_summary, fmt);

		// ── Collection Priority ────────────────────────────────────────────────
		const priority_rows = (top_customers || []).map(c => `
			<div style="display:flex;justify-content:space-between;align-items:center;
			            padding:12px 18px;border-bottom:1px solid #edf2f7;cursor:pointer;
			            transition:background .12s;"
			     onmouseover="this.style.background='#f7fafc'"
			     onmouseout="this.style.background=''"
			     onclick="frappe.set_route('outstanding-invoices')">
				<div>
					<div style="font-weight:600;font-size:13px;color:#2d3748;">
						${c.customer_name || c.customer}
					</div>
					<div style="font-size:11px;color:#a0aec0;margin-top:2px;">${c.customer}</div>
				</div>
				<div style="text-align:right;">
					<div style="color:#e53e3e;font-weight:700;">${fmt(c.outstanding_amount)}</div>
					<div style="font-size:11px;color:#a0aec0;">${c.invoice_count} Open Invoices</div>
				</div>
			</div>
		`).join("");

		const hdr = `style="display:flex;justify-content:space-between;align-items:center;
		                     padding:14px 18px;border-bottom:1px solid #edf2f7;font-weight:600;
		                     font-size:14px;color:#2d3748;"`;
		const btn = `style="padding:4px 12px;border:1px solid #cbd5e0;border-radius:4px;
		                     background:#fff;color:#2b6cb0;font-size:12px;cursor:pointer;"`;

		$("#dc-priority").html(`
			<div ${hdr}>
				<span>Collection Priority</span>
				<button ${btn} onclick="frappe.set_route('outstanding-invoices')">View All</button>
			</div>
			${priority_rows || "<p style='color:#a0aec0;padding:16px;'>No outstanding invoices.</p>"}
		`);

		// ── Recent Activity ────────────────────────────────────────────────────
		const activity_rows = (recent_activity || []).map(a => `
			<div style="display:flex;gap:12px;padding:12px 18px;border-bottom:1px solid #edf2f7;">
				<div style="width:36px;height:36px;border-radius:50%;background:#bee3f8;color:#2b6cb0;
				            display:flex;align-items:center;justify-content:center;
				            font-weight:700;font-size:15px;flex-shrink:0;">
					${(a.customer_name || "?")[0]}
				</div>
				<div>
					<div style="font-weight:600;font-size:13px;color:#2d3748;">
						${a.customer_name || a.customer}
					</div>
					<div style="font-size:11px;color:#718096;">${a.contact_method}</div>
					<div style="font-size:12px;color:#4a5568;margin-top:2px;">
						${(a.remarks || "").substring(0, 80)}${(a.remarks || "").length > 80 ? "…" : ""}
					</div>
					<div style="font-size:11px;color:#a0aec0;margin-top:2px;">
						${frappe.datetime.str_to_user(a.created_date)}
					</div>
				</div>
			</div>
		`).join("");

		$("#dc-activity").html(`
			<div ${hdr}><span>Recent Activity</span></div>
			${activity_rows || "<p style='color:#a0aec0;padding:16px;'>No recent activity.</p>"}
		`);
	}

	// ── Salesperson section ───────────────────────────────────────────────────
	_render_sp_section(sp_data, fmt) {
		if (!sp_data || !sp_data.length) { $("#dc-sp-wrap").empty(); return; }

		const total = sp_data.reduce((s, r) => s + (parseFloat(r.outstanding_amount) || 0), 0);

		// Build select options
		const opts = sp_data.map(r =>
			`<option value="${r.sales_person}">${r.sales_person}</option>`
		).join("");

		const rows = sp_data.map(r => {
			const pct   = total > 0 ? (parseFloat(r.outstanding_amount) / total * 100).toFixed(1) : 0;
			const color = parseFloat(r.outstanding_amount) / total > 0.3 ? "#e53e3e" : "#2b6cb0";
			return `
				<div style="display:flex;justify-content:space-between;align-items:center;
				            padding:10px 18px;border-bottom:1px solid #edf2f7;">
					<div style="flex:1;min-width:0;">
						<div style="font-weight:600;font-size:13px;color:#2d3748;">
							${r.sales_person}
						</div>
						<div style="font-size:11px;color:#a0aec0;margin-top:2px;">
							${r.customer_count} customers · ${pct}% of total
						</div>
						<div style="height:3px;background:#edf2f7;border-radius:2px;
						            margin-top:5px;width:100%;overflow:hidden;">
							<div style="width:${pct}%;height:100%;background:${color};
							            border-radius:2px;"></div>
						</div>
					</div>
					<div style="text-align:right;margin-left:16px;flex-shrink:0;">
						<div style="font-weight:700;color:#e53e3e;font-size:14px;">
							${fmt(r.outstanding_amount)}
						</div>
						<button onclick="frappe.set_route('outstanding-invoices', {sales_person: '${r.sales_person}'})"
						        style="margin-top:4px;padding:2px 10px;border:1px solid #cbd5e0;
						               border-radius:4px;background:#fff;color:#2b6cb0;
						               font-size:11px;cursor:pointer;">
							View All →
						</button>
					</div>
				</div>
			`;
		}).join("");

		const hdr = `style="display:flex;justify-content:space-between;align-items:center;
		                     padding:14px 18px;border-bottom:1px solid #edf2f7;font-weight:600;
		                     font-size:14px;color:#2d3748;"`;

		$("#dc-sp-wrap").html(`
			<div style="background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08);
			            overflow:hidden;">
				<div ${hdr}>
					<span>Outstanding by Sales Person</span>
					<button onclick="frappe.set_route('salesperson-dashboard')"
					        style="padding:4px 12px;border:1px solid #cbd5e0;border-radius:4px;
					               background:#fff;color:#2b6cb0;font-size:12px;cursor:pointer;">
						Full Report →
					</button>
				</div>
				${rows}
			</div>
		`);
	}
}
