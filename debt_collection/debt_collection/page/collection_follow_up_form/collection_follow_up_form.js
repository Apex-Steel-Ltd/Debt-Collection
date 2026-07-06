frappe.pages["collection-follow-up-form"].on_page_load = function (wrapper) {
	frappe.collection_follow_up_form = new CollectionFollowUpFormPage(wrapper);
};

class CollectionFollowUpFormPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: "Customer Follow-Up",
			single_column: true,
		});

		// Read customer from URL param (safe — no HTML content)
		this.customer = frappe.utils.get_url_arg("customer") || "";

		// Read pre-selected invoices from sessionStorage (avoids URL encoding issues)
		this.pre_selected_invoices = [];
		try {
			const stored = sessionStorage.getItem("dc_followup_invoices");
			if (stored) {
				this.pre_selected_invoices = JSON.parse(stored);
				sessionStorage.removeItem("dc_followup_invoices"); // consume once
			}
		} catch (e) { /* ignore */ }

		this.all_invoices = [];
		this.cc_contacts = []; // [{name, email}]
		this.render_layout();
		if (this.customer) {
			this.set_customer(this.customer);
		}
	}

	render_layout() {
		$(this.page.body).html(`
			<div style="display:grid;grid-template-columns:380px 1fr;gap:24px;
			            padding:20px;min-height:calc(100vh - 120px);">
				<div style="overflow-y:auto;padding-right:8px;">
					<div style="font-size:13px;font-weight:600;text-transform:uppercase;
					            letter-spacing:.5px;color:#4a5568;margin-bottom:14px;">
						Follow-Up Details
					</div>
					<div id="fu-form"></div>
					<!-- CC Contacts multi-select -->
					<div style="margin-bottom:14px;">
						<label style="font-size:11px;color:#718096;text-transform:uppercase;
						              letter-spacing:.4px;display:block;margin-bottom:6px;">
							CC Contacts
						</label>
						<div id="fu-cc-wrap" style="border:1px solid #cbd5e0;border-radius:4px;
						                            padding:6px 8px;min-height:36px;background:#fff;
						                            display:flex;flex-wrap:wrap;gap:4px;cursor:text;"
						     onclick="document.getElementById('fu-cc-search').focus()">
							<input id="fu-cc-search" type="text" placeholder="Search contacts..."
							       style="border:none;outline:none;font-size:12px;min-width:120px;
							              flex:1;background:transparent;">
						</div>
						<div id="fu-cc-dropdown" style="display:none;position:absolute;
						                                background:#fff;border:1px solid #cbd5e0;
						                                border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,.1);
						                                max-height:200px;overflow-y:auto;z-index:1000;
						                                min-width:280px;"></div>
					</div>
					<button style="margin-top:24px;width:100%;padding:9px 20px;background:#2b6cb0;
					               color:#fff;border:none;border-radius:6px;font-size:14px;
					               font-weight:600;cursor:pointer;" id="fu-submit">
						✉ Submit Follow-Up
					</button>
				</div>
				<div style="overflow:hidden;">
					<div style="display:flex;justify-content:space-between;align-items:center;
					            margin-bottom:12px;">
						<div>
							<div style="font-size:13px;font-weight:600;text-transform:uppercase;
							            letter-spacing:.5px;color:#4a5568;">Outstanding Invoices</div>
							<div id="fu-inv-count" style="color:#718096;font-size:13px;"></div>
						</div>
					</div>
					<div id="fu-inv-table" style="overflow-y:auto;max-height:calc(100vh - 300px);"></div>
				</div>
			</div>
		`);

		this._build_form();
		this._setup_cc_contacts();
		$(this.page.body).on("click", "#fu-submit", () => this.submit());
	}

	_build_form() {
		// Weekly Collection Plan removed — it gets pre-set silently if provided
		const fields = [
			{ fieldtype: "Link", fieldname: "customer", label: "Customer",
			  options: "Customer", reqd: 1,
			  change: () => {
				const new_customer = this.form_fields.customer.get_value();
				if (new_customer !== this.customer) {
					// Only clear pre-selections if customer actually changed
					this.pre_selected_invoices = [];
				}
				this.customer = new_customer;
				this._load_cc_contacts();
				this.load_invoices();
			  }
			},
			{ fieldtype: "Select", fieldname: "contact_method", label: "Contact Method",
			  reqd: 1, options: "Call\nEmail\nPhysical Visit\nSMS\nWhatsApp" },
			{ fieldtype: "Link", fieldname: "contact_person", label: "Contact Person",
			  options: "Contact",
			  get_query: () => {
				// Use a server-side method that doesn't require Dynamic Link read permission
				return {
					query: "debt_collection.debt_collection.api.debt_api.get_contact_query",
					filters: { customer: this.customer },
				};
			  },
			},
			{ fieldtype: "Date", fieldname: "next_follow_up_date", label: "Next Follow-Up Date" },
			{ fieldtype: "Attach", fieldname: "supporting_document", label: "Supporting Document" },
			{ fieldtype: "Small Text", fieldname: "remarks", label: "Remarks", reqd: 1 },
		];

		this.form_fields = {};
		const $form = $("#fu-form");
		$form.empty();

		fields.forEach(f => {
			const w = $(`<div style="margin-bottom:14px;"></div>`).appendTo($form);
			const field = frappe.ui.form.make_control({
				parent: w[0], df: f, render_input: true,
			});
			field.refresh();
			this.form_fields[f.fieldname] = field;
		});

		if (this.customer) {
			this.form_fields.customer.set_value(this.customer);
		}
	}

	// ── CC Contacts multi-select ──────────────────────────────────────────────
	_setup_cc_contacts() {
		const $search = $("#fu-cc-search");
		const $dropdown = $("#fu-cc-dropdown");
		let contacts_cache = [];

		$search.on("input", () => {
			const q = $search.val().toLowerCase();
			const filtered = contacts_cache.filter(c =>
				c.name.toLowerCase().includes(q) ||
				(c.email || "").toLowerCase().includes(q)
			);
			this._render_cc_dropdown(filtered);
		});

		$search.on("focus", () => {
			if (contacts_cache.length) this._render_cc_dropdown(contacts_cache);
		});

		$(document).on("click.cc_close", (e) => {
			if (!$(e.target).closest("#fu-cc-wrap, #fu-cc-dropdown").length) {
				$dropdown.hide();
			}
		});

		// Load contacts when customer is set
		this._load_cc_contacts = () => {
			if (!this.customer) return;
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Contact",
					filters: [["Dynamic Link", "link_doctype", "=", "Customer"],
					          ["Dynamic Link", "link_name",  "=", this.customer]],
					fields: ["name", "first_name", "last_name", "email_id"],
					limit: 50,
				},
				callback: (r) => {
					contacts_cache = (r.message || []).map(c => ({
						name:  c.name,
						label: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.name,
						email: c.email_id || "",
					}));
					this._render_cc_dropdown(contacts_cache);
				},
			});
		};
	}

	_render_cc_dropdown(contacts) {
		const $dropdown = $("#fu-cc-dropdown");
		const selected_names = new Set(this.cc_contacts.map(c => c.name));
		const items = contacts.filter(c => !selected_names.has(c.name));

		if (!items.length) { $dropdown.hide(); return; }

		$dropdown.html(items.map(c => `
			<div class="fu-cc-item" data-name="${c.name}" data-email="${c.email}"
			     data-label="${c.label}"
			     style="padding:8px 12px;cursor:pointer;font-size:13px;
			            border-bottom:1px solid #edf2f7;">
				<div style="font-weight:600;color:#2d3748;">${c.label}</div>
				<div style="font-size:11px;color:#718096;">${c.email || "No email"}</div>
			</div>
		`).join("")).show();

		// Position below the wrap
		const wrap = document.getElementById("fu-cc-wrap");
		const rect = wrap.getBoundingClientRect();
		$dropdown.css({
			top: rect.bottom + window.scrollY + 2,
			left: rect.left + window.scrollX,
			width: rect.width,
		});

		$dropdown.find(".fu-cc-item").on("click", (e) => {
			const el = $(e.currentTarget);
			this._add_cc({ name: el.data("name"), label: el.data("label"), email: el.data("email") });
			$("#fu-cc-search").val("").focus();
			$dropdown.hide();
		});
	}

	_add_cc(contact) {
		if (this.cc_contacts.find(c => c.name === contact.name)) return;
		this.cc_contacts.push(contact);
		this._render_cc_pills();
	}

	_remove_cc(name) {
		this.cc_contacts = this.cc_contacts.filter(c => c.name !== name);
		this._render_cc_pills();
	}

	_render_cc_pills() {
		// Remove existing pills (keep the search input)
		$("#fu-cc-wrap .fu-cc-pill").remove();
		this.cc_contacts.forEach(c => {
			const pill = $(`
				<span class="fu-cc-pill"
				      style="background:#bee3f8;color:#2b6cb0;padding:2px 8px;border-radius:10px;
				             font-size:12px;display:inline-flex;align-items:center;gap:4px;">
					${c.label}${c.email ? ` <span style="opacity:.7;font-size:10px;">&lt;${c.email}&gt;</span>` : ""}
					<span data-name="${c.name}"
					      style="cursor:pointer;font-weight:700;margin-left:2px;opacity:.6;"
					      class="fu-cc-remove">×</span>
				</span>
			`);
			pill.find(".fu-cc-remove").on("click", (e) => {
				e.stopPropagation();
				this._remove_cc($(e.currentTarget).data("name"));
			});
			pill.insertBefore($("#fu-cc-search"));
		});
	}

	set_customer(customer) {
		this.customer = customer;
		// Set value silently — use set_value which won't re-trigger change if already set
		this.form_fields.customer.set_value(customer);
		this._load_cc_contacts && this._load_cc_contacts();
		// Load invoices directly — don't wait for the Link field change event
		this.load_invoices();
	}

	load_invoices() {
		if (!this.customer) return;
		// Snapshot pre-selections before async call
		const pre = this.pre_selected_invoices.slice();
		frappe.call({
			method: "debt_collection.debt_collection.api.debt_api.get_customer_invoices",
			args: { customer: this.customer },
			callback: (r) => {
				if (!r.message) return;
				this.all_invoices = r.message.invoices;
				this.render_invoice_table(this.all_invoices, pre);
			},
		});
	}

	render_invoice_table(invoices, pre_selected) {
		// pre_selected can be passed in, or fall back to this.pre_selected_invoices
		const pre = pre_selected || this.pre_selected_invoices;
		const fmt = (v) => format_currency(v, "KES");
		$("#fu-inv-count").text(`${invoices.length} pending invoice${invoices.length !== 1 ? "s" : ""}`);

		const th = `style="padding:7px 10px;text-align:left;font-size:11px;font-weight:600;
		                    color:#4a5568;border-bottom:2px solid #e2e8f0;white-space:nowrap;"`;
		const td = (extra) => `style="padding:7px 10px;border-bottom:1px solid #edf2f7;
		                                font-size:12px;color:#2d3748;${extra||""}"`;

		const rows = invoices.map((inv, i) => {
			const checked = pre.some(p => p.sales_invoice === inv.name);
			return `
				<tr onmouseover="this.style.background='#f7fafc'"
				    onmouseout="this.style.background=''">
					<td ${td()}><input type="checkbox" class="fu-inv-check"
					              data-idx="${i}" ${checked ? "checked" : ""}></td>
					<td ${td()}>${i + 1}</td>
					<td ${td()}>
						<a href="/app/sales-invoice/${inv.name}" target="_blank"
						   style="color:#2b6cb0;">${inv.name}</a>
					</td>
					<td ${td()}>${inv.invoice_date || "-"}</td>
					<td ${td()}>${inv.due_date || "-"}</td>
					<td ${td(`font-weight:700;color:${inv.overdue_days > 90 ? "#e53e3e" : inv.overdue_days > 30 ? "#dd6b20" : "#2d3748"};`)}>
						${inv.overdue_days}
					</td>
					<td ${td()}>${inv.payment_terms || "CASH"}</td>
					<td ${td()}>${fmt(inv.invoice_amount)}</td>
					<td ${td(`color:${inv.pdc_amount > 0 ? "#d69e2e" : "#a0aec0"};`)}>
						${fmt(inv.pdc_amount)}
					</td>
					<td ${td("font-weight:600;")}>${fmt(inv.net_outstanding)}</td>
				</tr>
			`;
		}).join("");

		$("#fu-inv-table").html(`
			<div style="overflow-x:auto;">
				<table style="width:100%;border-collapse:collapse;background:#fff;font-size:12px;">
					<thead style="background:#f7fafc;">
						<tr>
							<th ${th}><input type="checkbox" id="fu-select-all"></th>
							<th ${th}>#</th><th ${th}>Inv No.</th>
							<th ${th}>Inv Date</th><th ${th}>Due Date</th>
							<th ${th}>Overdue Days</th><th ${th}>Terms</th>
							<th ${th}>Inv Amt</th><th ${th}>PDC Amt</th>
							<th ${th}>Net Outstanding</th>
						</tr>
					</thead>
					<tbody>${rows || `<tr><td colspan="10" style="text-align:center;
					                      padding:20px;color:#a0aec0;">
					                      No outstanding invoices.</td></tr>`}</tbody>
				</table>
			</div>
		`);

		$("#fu-select-all").on("change", function() {
			$(".fu-inv-check").prop("checked", this.checked);
		});
	}

	get_selected_invoices() {
		const selected = [];
		$(".fu-inv-check:checked").each((_, el) => {
			const inv = this.all_invoices[$(el).data("idx")];
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
				payment_terms:      inv.payment_terms,
			});
		});
		return selected;
	}

	submit() {
		let valid = true;
		const values = {};
		["customer", "contact_method", "remarks"].forEach(f => {
			const v = this.form_fields[f].get_value();
			if (!v) {
				frappe.msgprint(`${this.form_fields[f].df.label} is required.`, "Validation Error");
				valid = false;
			}
			values[f] = v;
		});
		if (!valid) return;

		["contact_person", "next_follow_up_date", "supporting_document"].forEach(f => {
			values[f] = this.form_fields[f].get_value();
		});

		// Collect CC emails from selected contacts
		const cc_emails = this.cc_contacts
			.filter(c => c.email)
			.map(c => c.email)
			.join(", ");

		const selected_invoices = this.get_selected_invoices();

		frappe.call({
			method: "debt_collection.debt_collection.api.debt_api.save_follow_up",
			args: {
				customer:              values.customer,
				contact_method:        values.contact_method,
				contact_person:        values.contact_person || null,
				cc_contacts:           cc_emails || null,
				next_follow_up_date:   values.next_follow_up_date || null,
				remarks:               values.remarks,
				supporting_document:   values.supporting_document || null,
				weekly_collection_plan: null,
				invoices:              JSON.stringify(selected_invoices),
			},
			freeze: true,
			freeze_message: "Saving follow-up...",
			callback: (r) => {
				if (!r.message) return;
				frappe.show_alert({
					message: `Follow-up ${r.message} saved.`,
					indicator: "green",
				}, 5);
				frappe.set_route("follow-up-dashboard");
			},
		});
	}
}
