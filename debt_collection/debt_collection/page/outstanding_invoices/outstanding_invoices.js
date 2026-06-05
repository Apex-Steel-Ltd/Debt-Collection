frappe.pages["outstanding-invoices"].on_page_load = function (wrapper) {
	frappe.outstanding_invoices = new OutstandingInvoicesPage(wrapper);
};

class OutstandingInvoicesPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: "Outstanding Customer Invoices",
			single_column: true,
		});
		this.current_filter = "all";
		this.current_page = 1;
		this.page_size = 50;
		this.selected_customers = new Set();
		this.setup_toolbar();
		this.render_layout();
		this.load();
	}

	setup_toolbar() {
		this.page.set_secondary_action("Add to Planner", () => this.show_planner_dialog(), "add");
		this.page.set_primary_action("Refresh", () => this.load(), "refresh");
		this.$search = this.page.add_field({
			fieldtype: "Data",
			fieldname: "search",
			label: "Search Customers",
			placeholder: "Search customers...",
			change: () => { this.current_page = 1; this.load(); },
		});
		this.$collector = this.page.add_field({
			fieldtype: "Link",
			fieldname: "collector",
			label: "Collector",
			options: "User",
			change: () => { this.current_page = 1; this.load(); },
		});
		this.$sales_person = this.page.add_field({
			fieldtype: "Select",
			fieldname: "sales_person",
			label: "Sales Person",
			options: "",
			change: () => { this.current_page = 1; this.load(); },
		});

		// Populate sales person dropdown
		frappe.call({
			method: "debt_collection.debt_collection.api.debt_api.get_sales_persons",
			callback: (r) => {
				if (!r.message) return;
				this.$sales_person.df.options = ["", ...r.message].join("\n");
				this.$sales_person.refresh();
			},
		});
	}

	render_layout() {
		$(this.page.body).html(`
			<div class="dc-page">
				<div class="dc-tab-bar" id="oi-tabs">
					${["all","over_120","over_90","over_60","over_30","current"].map(f => `
						<button class="dc-tab ${f === "all" ? "active" : ""}" data-filter="${f}">
							${this.filter_label(f)}
						</button>
					`).join("")}
				</div>
				<div id="oi-table-wrap" style="margin-top:16px;"></div>
				<div id="oi-pagination" style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px;"></div>
			</div>
		`);

		$(this.page.body).on("click", ".dc-tab", (e) => {
			$(".dc-tab").removeClass("active");
			$(e.currentTarget).addClass("active");
			this.current_filter = $(e.currentTarget).data("filter");
			this.current_page = 1;
			this.selected_customers.clear();
			this.load();
		});

		$(this.page.body).on("change", "#oi-select-all", (e) => {
			const checked = e.target.checked;
			$(this.page.body).find(".oi-row-check").prop("checked", checked);
			checked
				? this._visible_customers().forEach(c => this.selected_customers.add(c))
				: this.selected_customers.clear();
		});

		$(this.page.body).on("change", ".oi-row-check", (e) => {
			const customer = $(e.target).data("customer");
			e.target.checked ? this.selected_customers.add(customer) : this.selected_customers.delete(customer);
		});

		$(this.page.body).on("click", ".oi-view-btn", (e) => {
			const customer = $(e.currentTarget).data("customer");
			this.show_customer_drawer(customer);
		});
	}

	filter_label(f) {
		return { all: "All", over_120: "Over 120 Days", over_90: "Over 90 Days", over_60: "Over 60 Days", over_30: "Over 30 Days", current: "Current" }[f];
	}

	_visible_customers() {
		return $(this.page.body).find(".oi-row-check").map((_, el) => $(el).data("customer")).get();
	}

	load() {
		const search = this.$search ? this.$search.get_value() : "";
		const collector = this.$collector ? this.$collector.get_value() : "";
		const sales_person = this.$sales_person ? this.$sales_person.get_value() : "";
		frappe.call({
			method: "debt_collection.debt_collection.api.debt_api.get_outstanding_customers",
			args: {
				ageing_filter: this.current_filter === "all" ? null : this.current_filter,
				collector: collector || null,
				sales_person: sales_person || null,
				search: search || null,
				page: this.current_page,
				page_size: this.page_size,
			},
			callback: (r) => {
				if (!r.message) return;
				this.render_table(r.message.data);
				this.render_pagination(r.message.total);
			},
		});
	}

	render_table(rows) {
		const fmt = (v) => format_currency(v, "KES");
		const row_html = rows.map(r => `
			<tr>
				<td><input type="checkbox" class="oi-row-check" data-customer="${r.customer}"></td>
				<td>
					<button class="dc-link-btn oi-view-btn" data-customer="${r.customer}">${r.customer_name || r.customer}</button>
					${r.debt_collector ? `<span class="dc-badge-blue" style="margin-left:6px;">Planned</span>` : ""}
				</td>
				<td style="color:#553c9a;font-size:12px;">${r.sales_person || "—"}</td>
				<td>${fmt(r.total_inv_amount)}</td>
				<td style="font-weight:600;">${fmt(r.outstanding_amount)}</td>
				<td>${fmt(r.pdc_amount)}</td>
				<td style="font-weight:700;color:#2b6cb0;">${fmt(r.net_outstanding)}</td>
				<td style="color:${r.avg_overdue_days > 90 ? "#e53e3e" : r.avg_overdue_days > 30 ? "#dd6b20" : "#38a169"};font-weight:700;">${Math.round(r.avg_overdue_days || 0)}</td>
				<td style="color:#e53e3e;">${fmt(r.interest_loss)}</td>
			</tr>
		`).join("");

		$("#oi-table-wrap").html(`
			<table class="dc-table">
				<thead>
					<tr>
						<th><input type="checkbox" id="oi-select-all"></th>
						<th>Name</th>
						<th>Sales Person</th>
						<th>Total Inv Amount</th>
						<th>Outstanding Amount ↓</th>
						<th>PDC Amount</th>
						<th>Net Outstanding</th>
						<th>Avg Overdue Days</th>
						<th>14% Interest Loss</th>
					</tr>
				</thead>
				<tbody>${row_html || '<tr><td colspan="9" style="text-align:center;color:#a0aec0;padding:32px;">No outstanding invoices found.</td></tr>'}</tbody>
			</table>
		`);
	}

	render_pagination(total) {
		const pages = Math.ceil(total / this.page_size);
		let html = `<span style="color:#718096;font-size:13px;">Showing ${Math.min((this.current_page - 1) * this.page_size + 1, total)} - ${Math.min(this.current_page * this.page_size, total)} of ${total}</span>`;
		if (this.current_page > 1) html += `<button class="dc-btn-sm" id="oi-prev">‹ Prev</button>`;
		if (this.current_page < pages) html += `<button class="dc-btn-sm" id="oi-next">Next ›</button>`;
		$("#oi-pagination").html(html);
		$("#oi-prev").on("click", () => { this.current_page--; this.load(); });
		$("#oi-next").on("click", () => { this.current_page++; this.load(); });
	}

	show_planner_dialog() {
		if (this.selected_customers.size === 0) {
			frappe.msgprint("Please select at least one customer.", "No Selection");
			return;
		}
		const today = frappe.datetime.get_today();
		const mon = this._monday_of(today);
		const weeks = [
			{ label: `Current Week — ${frappe.datetime.str_to_user(mon)} to ${frappe.datetime.str_to_user(this._add_days(mon, 6))}`, value: mon },
			{ label: `Next Week — ${frappe.datetime.str_to_user(this._add_days(mon, 7))} to ${frappe.datetime.str_to_user(this._add_days(mon, 13))}`, value: this._add_days(mon, 7) },
			{ label: `Next to Next Week — ${frappe.datetime.str_to_user(this._add_days(mon, 14))} to ${frappe.datetime.str_to_user(this._add_days(mon, 20))}`, value: this._add_days(mon, 14) },
		];
		const d = new frappe.ui.Dialog({
			title: `Add to Weekly Planner`,
			fields: [
				{
					label: "Schedule " + this.selected_customers.size + " customer(s) for collection follow-ups.",
					fieldtype: "HTML",
					options: `<p style="color:#718096;margin-bottom:12px;">Select Collection Week</p>`,
				},
				{
					fieldname: "week_start",
					label: "Collection Week",
					fieldtype: "Select",
					options: weeks.map(w => w.label).join("\n"),
					default: weeks[0].label,
					reqd: 1,
				},
			],
			primary_action_label: "Confirm Plan",
			primary_action: (values) => {
				const week = weeks.find(w => w.label === values.week_start);
				frappe.call({
					method: "debt_collection.debt_collection.api.debt_api.add_customers_to_plan",
					args: {
						customers: JSON.stringify([...this.selected_customers]),
						week_start: week.value,
					},
					freeze: true,
					freeze_message: "Adding to plan...",
					callback: (r) => {
						if (!r.message) return;
						const { plan, added, skipped } = r.message;
						d.hide();
						let msg = `Added <b>${added.length}</b> customer(s) to plan <a href="/app/weekly-collection-plan/${plan}">${plan}</a>.`;
						if (skipped.length) msg += `<br>${skipped.length} already scheduled (skipped).`;
						frappe.msgprint(msg, "Plan Updated");
						this.selected_customers.clear();
					},
				});
			},
		});
		d.show();
	}

	show_customer_drawer(customer) {
		frappe.call({
			method: "debt_collection.debt_collection.api.debt_api.get_customer_invoices",
			args: { customer },
			callback: (r) => {
				if (!r.message) return;
				const { invoices, ageing } = r.message;
				this._render_customer_drawer(customer, invoices, ageing);
			},
		});
	}

	_render_customer_drawer(customer, invoices, ageing) {
		const fmt = (v) => format_currency(v, "KES");
		const ageing_sorted = Object.entries(ageing).sort((a, b) => b[0].localeCompare(a[0]));
		const ageing_html = ageing_sorted.map(([month, amt]) => `
			<div class="dc-ageing-bucket">
				<div class="dc-ageing-month">${month}</div>
				<div class="dc-ageing-amt">${fmt(amt)}</div>
			</div>
		`).join("");

		const invoice_rows = invoices.map((inv, i) => `
			<tr>
				<td><input type="checkbox" class="drawer-inv-check" data-inv='${JSON.stringify({
					sales_invoice: inv.name, invoice_date: inv.invoice_date, due_date: inv.due_date,
					overdue_days: inv.overdue_days, invoice_amount: inv.invoice_amount,
					outstanding_amount: inv.outstanding_amount, pdc_amount: inv.pdc_amount,
					pdc_date: inv.pdc_date, net_outstanding: inv.net_outstanding
				})}'></td>
				<td>${i + 1}</td>
				<td><a href="/app/sales-invoice/${inv.name}" target="_blank">${inv.name}</a></td>
				<td>${inv.payment_terms || "-"}</td>
				<td>${inv.invoice_date || "-"}</td>
				<td>${inv.due_date || "-"}</td>
				<td style="color:${inv.overdue_days > 90 ? "#e53e3e" : inv.overdue_days > 30 ? "#dd6b20" : "#2d3748"};font-weight:700;">${inv.overdue_days}</td>
				<td>${fmt(inv.invoice_amount)}</td>
				<td>${fmt(inv.outstanding_amount)}</td>
				<td>${fmt(inv.pdc_amount)}</td>
				<td>${fmt(inv.net_outstanding)}</td>
				<td>${inv.pdc_date || "-"}</td>
			</tr>
		`).join("");

		const d = new frappe.ui.Dialog({
			title: customer,
			size: "extra-large",
			fields: [
				{
					fieldtype: "HTML",
					options: `
						<p style="color:#718096;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Invoices and Follow Up Details</p>
						<div class="dc-ageing-buckets">${ageing_html}</div>
						<div style="display:flex;justify-content:space-between;align-items:center;margin:20px 0 10px;">
							<div>
								<div style="font-weight:700;font-size:15px;">Outstanding Invoices</div>
								<div style="color:#718096;font-size:12px;">${invoices.length} pending invoices</div>
							</div>
						</div>
						<div style="overflow-x:auto;">
							<table class="dc-table dc-table-sm">
								<thead>
									<tr>
										<th></th><th>#</th><th>Trx No.</th><th>Terms</th>
										<th>Inv Date</th><th>Due Date</th><th>Days</th>
										<th>Inv Amt</th><th>Outstanding</th><th>PDC Amt</th>
										<th>Net Outstanding</th><th>PDC Date</th>
									</tr>
								</thead>
								<tbody>${invoice_rows}</tbody>
							</table>
						</div>
					`,
				},
			],
			primary_action_label: "Start Follow Up",
			primary_action: () => {
				const selected = [];
				d.$wrapper.find(".drawer-inv-check:checked").each((_, el) => {
					selected.push(JSON.parse($(el).data("inv")));
				});
				d.hide();
				frappe.set_route("collection-follow-up-form", { customer, invoices: JSON.stringify(selected) });
			},
		});
		d.show();
	}

	_monday_of(date_str) {
		const d = new Date(date_str);
		const day = d.getDay() || 7;
		d.setDate(d.getDate() - day + 1);
		return d.toISOString().split("T")[0];
	}

	_add_days(date_str, days) {
		const d = new Date(date_str);
		d.setDate(d.getDate() + days);
		return d.toISOString().split("T")[0];
	}
}
