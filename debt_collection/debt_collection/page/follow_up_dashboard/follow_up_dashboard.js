frappe.pages["follow-up-dashboard"].on_page_load = function (wrapper) {
	frappe.collection_follow_up_dashboard = new CollectionFollowUpDashboard(wrapper);
};

frappe.pages["follow-up-dashboard"].on_page_show = function (wrapper) {
	// Refresh when navigated back to (e.g. after saving a new follow-up)
	if (frappe.collection_follow_up_dashboard) {
		frappe.collection_follow_up_dashboard.load();
	}
};

class CollectionFollowUpDashboard {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: "Collection Follow-Ups",
			single_column: true,
		});
		this.current_page = 1;
		this.page_size = 25;
		this.week_filter = null;

		this._setup_toolbar();
		this._render_skeleton();
		this.load();
	}

	// ── Toolbar ───────────────────────────────────────────────────────────────
	_setup_toolbar() {
		this.page.set_primary_action("+ New Follow-Up", () => {
			frappe.set_route("collection-follow-up-form");
		}, "add");

		this.page.set_secondary_action("Refresh", () => this.load(), "refresh");

		this.$collector = this.page.add_field({
			fieldtype: "Link",
			fieldname: "collector",
			label: "Collector",
			options: "User",
			change: () => { this.current_page = 1; this.load(); },
		});

		this.$week = this.page.add_field({
			fieldtype: "Date",
			fieldname: "week_start",
			label: "Week (any date in week)",
			change: () => {
				const v = this.$week.get_value();
				this.week_filter = v ? this._monday_of(v) : null;
				this.current_page = 1;
				this.load();
			},
		});
	}

	// ── Skeleton ──────────────────────────────────────────────────────────────
	_render_skeleton() {
		$(this.page.body).html(`
			<div class="dc-page">
				<div id="cfu-week-summary"></div>
				<div id="cfu-list" style="margin-top:20px;"></div>
				<div id="cfu-pagination" style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px;align-items:center;"></div>
			</div>
		`);
	}

	// ── Load data ─────────────────────────────────────────────────────────────
	load() {
		const collector = this.$collector ? this.$collector.get_value() : null;
		frappe.call({
			method: "debt_collection.debt_collection.api.debt_api.get_follow_up_dashboard",
			args: {
				collector: collector || null,
				week_start: this.week_filter || null,
				page: this.current_page,
				page_size: this.page_size,
			},
			callback: (r) => {
				if (!r.message) return;
				this._render_week_summary(r.message.week_summary);
				this._render_list(r.message.data);
				this._render_pagination(r.message.total);
			},
		});
	}

	// ── Week summary cards ────────────────────────────────────────────────────
	_render_week_summary(weeks) {
		if (!weeks || !weeks.length) {
			$("#cfu-week-summary").empty();
			return;
		}
		const fmt = (v) => format_currency(v, "KES");
		const cards = weeks.map(w => `
			<div class="dc-cfu-week-card" data-week="${w.week_label}">
				<div class="dc-cfu-week-label">Week of ${frappe.datetime.str_to_user(w.week_label)}</div>
				<div class="dc-cfu-week-stats">
					<div class="dc-cfu-week-stat">
						<span class="dc-cfu-stat-num">${w.follow_up_count}</span>
						<span class="dc-cfu-stat-lbl">Follow-Ups</span>
					</div>
					<div class="dc-cfu-week-stat">
						<span class="dc-cfu-stat-num">${w.customer_count}</span>
						<span class="dc-cfu-stat-lbl">Customers</span>
					</div>
					<div class="dc-cfu-week-stat">
						<span class="dc-cfu-stat-num" style="color:#e53e3e;">${fmt(w.total_outstanding)}</span>
						<span class="dc-cfu-stat-lbl">Total Outstanding</span>
					</div>
				</div>
			</div>
		`).join("");
		$("#cfu-week-summary").html(`<div class="dc-cfu-week-row">${cards}</div>`);

		// Click a week card to filter list to that week
		$("#cfu-week-summary").on("click", ".dc-cfu-week-card", (e) => {
			const wk = $(e.currentTarget).data("week");
			$(".dc-cfu-week-card").removeClass("active");
			if (this.week_filter === wk) {
				// Toggle off
				this.week_filter = null;
				this.$week && this.$week.set_value("");
			} else {
				$(e.currentTarget).addClass("active");
				this.week_filter = wk;
				this.$week && this.$week.set_value(wk);
			}
			this.current_page = 1;
			this.load();
		});
	}

	// ── Follow-up list ────────────────────────────────────────────────────────
	_render_list(rows) {
		const fmt = (v) => format_currency(v, "KES");
		if (!rows || !rows.length) {
			$("#cfu-list").html(`
				<div style="text-align:center;padding:48px;color:#a0aec0;font-size:14px;">
					No follow-ups found.
					<br><br>
					<button class="dc-btn-sm" onclick="frappe.set_route('collection-follow-up-form')">+ Create First Follow-Up</button>
				</div>
			`);
			return;
		}

		const row_html = rows.map(r => {
			const overdue_color = r.current_outstanding > 0 ? "#e53e3e" : "#38a169";
			const method_badge = this._method_badge(r.contact_method);
			const next_date = r.next_follow_up_date
				? `<span style="color:#d69e2e;font-size:11px;">📅 Next: ${frappe.datetime.str_to_user(r.next_follow_up_date)}</span>`
				: "";
			return `
				<div class="dc-cfu-row" data-name="${r.name}">
					<div class="dc-cfu-row-left">
						<div class="dc-cfu-customer">${r.customer_name || r.customer}</div>
						<div class="dc-cfu-meta">
							${method_badge}
							<span style="color:#718096;font-size:12px;">${r.collector_name || r.collector || ""}</span>
							<span style="color:#a0aec0;font-size:11px;">${frappe.datetime.str_to_user(r.created_date)}</span>
							${next_date}
						</div>
						<div class="dc-cfu-remarks">${(r.remarks || "").substring(0, 120)}${(r.remarks || "").length > 120 ? "…" : ""}</div>
					</div>
					<div class="dc-cfu-row-right">
						<div style="font-size:18px;font-weight:700;color:${overdue_color};">${fmt(r.current_outstanding)}</div>
						<div style="font-size:11px;color:#718096;">Current Outstanding</div>
						<button class="dc-btn-sm dc-cfu-edit-btn" data-name="${r.name}" style="margin-top:10px;">Edit</button>
					</div>
				</div>
			`;
		}).join("");

		$("#cfu-list").html(`<div class="dc-cfu-list">${row_html}</div>`);

		// Store rows for edit dialog lookup
		this._rows_cache = {};
		rows.forEach(r => { this._rows_cache[r.name] = r; });

		// Edit button click
		$("#cfu-list").on("click", ".dc-cfu-edit-btn", (e) => {
			e.stopPropagation();
			const name = $(e.currentTarget).data("name");
			this._show_edit_dialog(this._rows_cache[name]);
		});

		// Row click also opens edit
		$("#cfu-list").on("click", ".dc-cfu-row", (e) => {
			if ($(e.target).hasClass("dc-cfu-edit-btn")) return;
			const name = $(e.currentTarget).data("name");
			this._show_edit_dialog(this._rows_cache[name]);
		});
	}

	// ── Edit dialog ───────────────────────────────────────────────────────────
	_show_edit_dialog(row) {
		const fmt = (v) => format_currency(v, "KES");
		const d = new frappe.ui.Dialog({
			title: `Follow-Up — ${row.customer_name || row.customer}`,
			size: "large",
			fields: [
				// Read-only summary at top
				{
					fieldtype: "HTML",
					options: `
						<div style="display:flex;gap:24px;padding:14px 0 18px;border-bottom:1px solid #edf2f7;margin-bottom:18px;">
							<div>
								<div style="font-size:11px;color:#718096;text-transform:uppercase;">Customer</div>
								<div style="font-weight:700;font-size:14px;">${row.customer_name || row.customer}</div>
								<div style="font-size:12px;color:#718096;">${row.customer}</div>
							</div>
							<div>
								<div style="font-size:11px;color:#718096;text-transform:uppercase;">Current Outstanding</div>
								<div style="font-weight:700;font-size:18px;color:#e53e3e;">${fmt(row.current_outstanding)}</div>
							</div>
							<div>
								<div style="font-size:11px;color:#718096;text-transform:uppercase;">Logged</div>
								<div style="font-weight:600;font-size:13px;">${frappe.datetime.str_to_user(row.created_date)}</div>
								<div style="font-size:12px;color:#718096;">by ${row.collector_name || row.collector || "-"}</div>
							</div>
						</div>
					`,
				},
				{
					fieldtype: "Select",
					fieldname: "contact_method",
					label: "Contact Method",
					options: "Call\nEmail\nPhysical Visit\nSMS\nWhatsApp",
					reqd: 1,
					default: row.contact_method,
				},
				{
					fieldtype: "Link",
					fieldname: "contact_person",
					label: "Contact Person",
					options: "Contact",
					default: row.contact_person,
				},
				{
					fieldtype: "Column Break",
				},
				{
					fieldtype: "Date",
					fieldname: "next_follow_up_date",
					label: "Next Follow-Up Date",
					default: row.next_follow_up_date,
				},
				{
					fieldtype: "Link",
					fieldname: "weekly_collection_plan",
					label: "Weekly Collection Plan",
					options: "Weekly Collection Plan",
					default: row.weekly_collection_plan,
				},
				{
					fieldtype: "Section Break",
					label: "Notes",
				},
				{
					fieldtype: "Small Text",
					fieldname: "remarks",
					label: "Remarks",
					reqd: 1,
					default: row.remarks,
				},
				{
					fieldtype: "Small Text",
					fieldname: "cc_contacts",
					label: "CC Contacts (Emails, comma separated)",
					default: row.cc_contacts,
				},
				{
					fieldtype: "Attach",
					fieldname: "supporting_document",
					label: "Supporting Document",
					default: row.supporting_document,
				},
			],
			primary_action_label: "Save Changes",
			primary_action: (values) => {
				frappe.call({
					method: "debt_collection.debt_collection.api.debt_api.update_follow_up",
					args: {
						name: row.name,
						contact_method: values.contact_method,
						remarks: values.remarks,
						next_follow_up_date: values.next_follow_up_date || null,
						contact_person: values.contact_person || null,
						cc_contacts: values.cc_contacts || null,
						supporting_document: values.supporting_document || null,
						weekly_collection_plan: values.weekly_collection_plan || null,
					},
					freeze: true,
					freeze_message: "Saving...",
					callback: (r) => {
						if (!r.message) return;
						d.hide();
						frappe.show_alert({ message: `Follow-up ${r.message} updated.`, indicator: "green" }, 4);
						this.load();
					},
				});
			},
		});
		d.show();
	}

	// ── Pagination ────────────────────────────────────────────────────────────
	_render_pagination(total) {
		const pages = Math.ceil(total / this.page_size);
		const start = Math.min((this.current_page - 1) * this.page_size + 1, total);
		const end = Math.min(this.current_page * this.page_size, total);
		let html = `<span style="color:#718096;font-size:13px;">${total ? `${start}–${end} of ${total}` : "No records"}</span>`;
		if (this.current_page > 1) html += `<button class="dc-btn-sm" id="cfu-prev">‹ Prev</button>`;
		if (this.current_page < pages) html += `<button class="dc-btn-sm" id="cfu-next">Next ›</button>`;
		$("#cfu-pagination").html(html);
		$("#cfu-prev").on("click", () => { this.current_page--; this.load(); });
		$("#cfu-next").on("click", () => { this.current_page++; this.load(); });
	}

	// ── Helpers ───────────────────────────────────────────────────────────────
	_method_badge(method) {
		const colors = {
			"Call": "#bee3f8:#2b6cb0",
			"Email": "#c6f6d5:#276749",
			"Physical Visit": "#fefcbf:#975a16",
			"SMS": "#e9d8fd:#553c9a",
			"WhatsApp": "#c6f6d5:#276749",
		};
		const [bg, fg] = (colors[method] || "#edf2f7:#4a5568").split(":");
		return `<span style="background:${bg};color:${fg};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">${method || "-"}</span>`;
	}

	_monday_of(date_str) {
		const d = new Date(date_str);
		const day = d.getDay() || 7;
		d.setDate(d.getDate() - day + 1);
		return d.toISOString().split("T")[0];
	}
}
