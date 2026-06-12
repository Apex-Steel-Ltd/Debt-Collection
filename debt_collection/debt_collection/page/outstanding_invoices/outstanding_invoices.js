frappe.pages["outstanding-invoices"].on_page_load = function (wrapper) {
	frappe.outstanding_invoices = new OutstandingInvoicesPage(wrapper);
};

frappe.pages["outstanding-invoices"].on_page_show = function (wrapper) {
	// Read sales_person from URL param and apply filter if present
	const sp = frappe.utils.get_url_arg("sales_person");
	if (sp && frappe.outstanding_invoices) {
		// Wait for dropdowns to be populated then set value
		const trySet = (attempts) => {
			const $sel = $("#oi-sales-person");
			if ($sel.find(`option[value="${sp}"]`).length) {
				$sel.val(sp);
				frappe.outstanding_invoices.current_page = 1;
				frappe.outstanding_invoices.load();
			} else if (attempts > 0) {
				setTimeout(() => trySet(attempts - 1), 200);
			}
		};
		trySet(10);
	}
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
		// Filter values read from body inputs — no page.add_field needed
	}

	render_layout() {
		const inp = `style="height:28px;border:1px solid #cbd5e0;border-radius:4px;padding:0 8px;
		                    font-size:12px;color:#2d3748;background:#fff;outline:none;"`;
		const lbl = `style="font-size:11px;color:#718096;margin-bottom:3px;display:block;
		                    text-transform:uppercase;letter-spacing:.4px;"`;

		$(this.page.body).html(`
			<div style="padding:20px;">

				<!-- Filter bar -->
				<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;
				            background:#fff;border:1px solid #e2e8f0;border-radius:8px;
				            padding:12px 16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.05);">
					<div>
						<label ${lbl}>Search</label>
						<input id="oi-search" type="text" placeholder="Customer name..."
						       ${inp} style="width:180px;height:28px;border:1px solid #cbd5e0;
						                    border-radius:4px;padding:0 8px;font-size:12px;">
					</div>
					<div>
						<label ${lbl}>Sales Person</label>
						<select id="oi-sales-person"
						        style="height:28px;border:1px solid #cbd5e0;border-radius:4px;
						               padding:0 8px;font-size:12px;color:#2d3748;
						               background:#fff;min-width:150px;">
							<option value="">All</option>
						</select>
					</div>
					<div>
						<label ${lbl}>Collector</label>
						<select id="oi-collector"
						        style="height:28px;border:1px solid #cbd5e0;border-radius:4px;
						               padding:0 8px;font-size:12px;color:#2d3748;
						               background:#fff;min-width:150px;">
							<option value="">All</option>
						</select>
					</div>
					<button id="oi-clear-filters"
					        style="height:28px;padding:0 12px;border:1px solid #cbd5e0;
					               border-radius:4px;background:#fff;color:#718096;
					               font-size:12px;cursor:pointer;">
						Clear
					</button>
				</div>

				<!-- Ageing filter tabs -->
				<div id="oi-tabs" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">
					${["all","over_120","over_90","over_60","over_30","current"].map(f => `
						<button class="oi-tab" data-filter="${f}"
							style="padding:6px 14px;border:1px solid ${f==="all"?"#2b6cb0":"#cbd5e0"};
							       border-radius:20px;background:${f==="all"?"#2b6cb0":"#fff"};
							       color:${f==="all"?"#fff":"#4a5568"};font-size:13px;cursor:pointer;
							       font-weight:${f==="all"?600:400};">
							${this.filter_label(f)}
						</button>
					`).join("")}
				</div>

				<div id="oi-table-wrap"></div>
				<div id="oi-pagination" style="margin-top:12px;display:flex;justify-content:flex-end;
				                               align-items:center;gap:8px;"></div>
			</div>
		`);

		// Populate Sales Person dropdown
		frappe.call({
			method: "debt_collection.debt_collection.api.debt_api.get_sales_persons",
			callback: (r) => {
				if (!r.message) return;
				r.message.forEach(sp => {
					$("#oi-sales-person").append(`<option value="${sp}">${sp}</option>`);
				});
			},
		});

		// Populate Collector dropdown
		frappe.call({
			method: "debt_collection.debt_collection.api.debt_api.get_collectors",
			callback: (r) => {
				if (!r.message) return;
				r.message.forEach(c => {
					$("#oi-collector").append(`<option value="${c.name}">${c.full_name}</option>`);
				});
			},
		});

		// Wire up filter events — debounce search
		let search_timer;
		$(this.page.body).on("input", "#oi-search", () => {
			clearTimeout(search_timer);
			search_timer = setTimeout(() => { this.current_page = 1; this.load(); }, 400);
		});
		$(this.page.body).on("change", "#oi-sales-person, #oi-collector", () => {
			this.current_page = 1; this.load();
		});
		$(this.page.body).on("click", "#oi-clear-filters", () => {
			$("#oi-search").val("");
			$("#oi-sales-person").val("");
			$("#oi-collector").val("");
			this.current_page = 1;
			this.load();
		});

		$(this.page.body).on("click", ".oi-tab", (e) => {
			$(this.page.body).find(".oi-tab").each((_, el) => {
				$(el).css({ background: "#fff", color: "#4a5568", borderColor: "#cbd5e0", fontWeight: 400 });
			});
			$(e.currentTarget).css({ background: "#2b6cb0", color: "#fff", borderColor: "#2b6cb0", fontWeight: 600 });
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
		return {
			all: "All",
			over_120: "Over 120 Days",
			over_90: "Over 90 Days",
			over_60: "Over 60 Days",
			over_30: "Over 30 Days",
			current: "Current (Not yet due)",
		}[f];
	}

	_visible_customers() {
		return $(this.page.body).find(".oi-row-check").map((_, el) => $(el).data("customer")).get();
	}

	load() {
		const search      = $("#oi-search").val() || null;
		const collector   = $("#oi-collector").val() || null;
		const sales_person = $("#oi-sales-person").val() || null;
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
		const th = `style="padding:10px 12px;text-align:left;font-weight:600;color:#4a5568;
		                    border-bottom:2px solid #e2e8f0;white-space:nowrap;font-size:13px;"`;
		const td_base = `style="padding:9px 12px;border-bottom:1px solid #edf2f7;font-size:13px;color:#2d3748;"`;

		const row_html = rows.map(r => `
			<tr style="transition:background .1s;" onmouseover="this.style.background='#f7fafc'"
			    onmouseout="this.style.background=''">
				<td ${td_base}><input type="checkbox" class="oi-row-check" data-customer="${r.customer}"></td>
				<td ${td_base}>
					<button class="oi-view-btn" data-customer="${r.customer}"
					        style="background:none;border:none;color:#2b6cb0;cursor:pointer;
					               font-size:13px;padding:0;text-align:left;">
						${r.customer_name || r.customer}
					</button>
					${r.debt_collector ? `<span style="margin-left:6px;padding:2px 8px;background:#bee3f8;
					                             color:#2b6cb0;border-radius:10px;font-size:11px;
					                             font-weight:600;">Planned</span>` : ""}
				</td>
				<td style="padding:9px 12px;border-bottom:1px solid #edf2f7;font-size:12px;
				           color:#553c9a;">${r.sales_person || "—"}</td>
				<td ${td_base}>${fmt(r.total_inv_amount)}</td>
				<td style="padding:9px 12px;border-bottom:1px solid #edf2f7;font-size:13px;
				           font-weight:600;color:#2d3748;">${fmt(r.outstanding_amount)}</td>
				<td ${td_base}>${fmt(r.pdc_amount)}</td>
				<td style="padding:9px 12px;border-bottom:1px solid #edf2f7;font-size:13px;
				           font-weight:700;color:#2b6cb0;">${fmt(r.net_outstanding)}</td>
				<td style="padding:9px 12px;border-bottom:1px solid #edf2f7;font-size:13px;font-weight:700;
				           color:${r.avg_overdue_days > 90 ? "#e53e3e" : r.avg_overdue_days > 30 ? "#dd6b20" : "#38a169"};">
					${Math.round(r.avg_overdue_days || 0)}
				</td>
				<td style="padding:9px 12px;border-bottom:1px solid #edf2f7;font-size:13px;
				           color:#e53e3e;">${fmt(r.interest_loss)}</td>
			</tr>
		`).join("");

		const table_style = `style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;
		                            border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);"`;
		const thead_style = `style="background:#f7fafc;"`;

		$("#oi-table-wrap").html(`
			<div style="overflow-x:auto;">
				<table ${table_style}>
					<thead ${thead_style}>
						<tr>
							<th ${th}><input type="checkbox" id="oi-select-all"></th>
							<th ${th}>Name</th>
							<th ${th}>Sales Person</th>
							<th ${th}>Total Inv Amount</th>
							<th ${th}>Outstanding Amount ↓</th>
							<th ${th}>PDC Amount</th>
							<th ${th}>Net Outstanding</th>
							<th ${th}>Avg Overdue Days</th>
							<th ${th}>14% Interest Loss</th>
						</tr>
					</thead>
					<tbody>${row_html || `<tr><td colspan="9" style="text-align:center;color:#a0aec0;
					                         padding:32px;font-size:14px;">
					                         No outstanding invoices found.</td></tr>`}</tbody>
				</table>
			</div>
		`);
	}

	render_pagination(total) {
		const pages = Math.ceil(total / this.page_size);
		const start = Math.min((this.current_page - 1) * this.page_size + 1, total);
		const end   = Math.min(this.current_page * this.page_size, total);
		const btn   = `style="padding:4px 12px;border:1px solid #cbd5e0;border-radius:4px;
		                      background:#fff;color:#2b6cb0;font-size:12px;cursor:pointer;"`;
		let html = `<span style="color:#718096;font-size:13px;">Showing ${start}–${end} of ${total}</span>`;
		if (this.current_page > 1) html += `<button ${btn} id="oi-prev">‹ Prev</button>`;
		if (this.current_page < pages) html += `<button ${btn} id="oi-next">Next ›</button>`;
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
			<div style="background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;
			            padding:10px 14px;min-width:110px;">
				<div style="font-size:11px;color:#718096;margin-bottom:3px;">${month}</div>
				<div style="font-size:15px;font-weight:700;color:#2d3748;">${fmt(amt)}</div>
			</div>
		`).join("");

		const invoice_rows = invoices.map((inv, i) => `
			<tr>
				<td style="padding:6px 8px;border-bottom:1px solid #edf2f7;">
					<input type="checkbox" class="drawer-inv-check" data-idx="${i}">
				</td>
				<td style="padding:6px 8px;border-bottom:1px solid #edf2f7;font-size:12px;">${i + 1}</td>
				<td style="padding:6px 8px;border-bottom:1px solid #edf2f7;font-size:12px;">
					<a href="/app/sales-invoice/${inv.name}" target="_blank">${inv.name}</a>
				</td>
				<td style="padding:6px 8px;border-bottom:1px solid #edf2f7;font-size:12px;">${inv.payment_terms || "-"}</td>
				<td style="padding:6px 8px;border-bottom:1px solid #edf2f7;font-size:12px;">${inv.invoice_date || "-"}</td>
				<td style="padding:6px 8px;border-bottom:1px solid #edf2f7;font-size:12px;">${inv.due_date || "-"}</td>
				<td style="padding:6px 8px;border-bottom:1px solid #edf2f7;font-size:12px;font-weight:700;
				           color:${inv.overdue_days > 90 ? "#e53e3e" : inv.overdue_days > 30 ? "#dd6b20" : "#2d3748"};">
					${inv.overdue_days}
				</td>
				<td style="padding:6px 8px;border-bottom:1px solid #edf2f7;font-size:12px;">${fmt(inv.invoice_amount)}</td>
				<td style="padding:6px 8px;border-bottom:1px solid #edf2f7;font-size:12px;">${fmt(inv.outstanding_amount)}</td>
				<td style="padding:6px 8px;border-bottom:1px solid #edf2f7;font-size:12px;">${fmt(inv.pdc_amount)}</td>
				<td style="padding:6px 8px;border-bottom:1px solid #edf2f7;font-size:12px;font-weight:600;">
					${fmt(inv.net_outstanding)}
				</td>
				<td style="padding:6px 8px;border-bottom:1px solid #edf2f7;font-size:12px;">${inv.pdc_date || "-"}</td>
			</tr>
		`).join("");

		const th = `style="padding:8px;text-align:left;font-size:11px;font-weight:600;color:#4a5568;
		                    border-bottom:2px solid #e2e8f0;white-space:nowrap;"`;

		const d = new frappe.ui.Dialog({
			title: customer,
			size: "extra-large",
			fields: [
				{
					fieldtype: "HTML",
					options: `
						<p style="color:#718096;font-size:12px;text-transform:uppercase;
						          letter-spacing:1px;margin-bottom:10px;">
							Invoices and Follow Up Details
						</p>
						<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px;">
							${ageing_html}
						</div>
						<div style="font-weight:700;font-size:15px;margin-bottom:4px;">
							Outstanding Invoices
						</div>
						<div style="color:#718096;font-size:12px;margin-bottom:12px;">
							${invoices.length} pending invoices
						</div>
						<div style="overflow-x:auto;">
							<table style="width:100%;border-collapse:collapse;font-size:12px;background:#fff;">
								<thead style="background:#f7fafc;">
									<tr>
										<th ${th}></th>
										<th ${th}>#</th><th ${th}>Trx No.</th><th ${th}>Terms</th>
										<th ${th}>Inv Date</th><th ${th}>Due Date</th><th ${th}>Days</th>
										<th ${th}>Inv Amt</th><th ${th}>Outstanding</th>
										<th ${th}>PDC Amt</th><th ${th}>Net Outstanding</th>
										<th ${th}>PDC Date</th>
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
					const idx = parseInt($(el).data("idx"));
					const inv = invoices[idx];
					if (inv) selected.push({
						sales_invoice:      inv.name,
						invoice_date:       inv.invoice_date,
						due_date:           inv.due_date,
						overdue_days:       inv.overdue_days,
						invoice_amount:     inv.invoice_amount,
						outstanding_amount: inv.outstanding_amount,
						pdc_amount:         inv.pdc_amount,
						pdc_date:           inv.pdc_date,
						net_outstanding:    inv.net_outstanding,
					});
				});
				d.hide();
				frappe.set_route("collection-follow-up-form", {
					customer,
					invoices: JSON.stringify(selected),
				});
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
