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
		this.customer = frappe.utils.get_url_arg("customer") || "";
		this.pre_selected_invoices = [];
		this.pre_weekly_plan = frappe.utils.get_url_arg("weekly_collection_plan") || "";
		try {
			const inv_param = frappe.utils.get_url_arg("invoices");
			if (inv_param) this.pre_selected_invoices = JSON.parse(decodeURIComponent(inv_param));
		} catch (e) { /* ignore */ }

		this.all_invoices = [];
		this.render_layout();
		if (this.customer) {
			this.set_customer(this.customer);
		}
	}

	render_layout() {
		$(this.page.body).html(`
			<div class="dc-followup-wrap">
				<div class="dc-followup-left">
					<div class="dc-section-title">Follow-Up Details</div>
					<div id="fu-form"></div>
					<button class="dc-btn-primary" id="fu-submit" style="margin-top:24px;width:100%;">
						✉ Submit Follow-Up
					</button>
				</div>
				<div class="dc-followup-right">
					<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
						<div>
							<div class="dc-section-title">Outstanding Invoices</div>
							<div id="fu-inv-count" style="color:#718096;font-size:13px;"></div>
						</div>
					</div>
					<div id="fu-inv-table" style="overflow-y:auto;max-height:calc(100vh - 300px);"></div>
				</div>
			</div>
		`);

		this._build_form();
		$(this.page.body).on("click", "#fu-submit", () => this.submit());
	}

	_build_form() {
		const fields = [
			{ fieldtype: "Link", fieldname: "customer", label: "Customer", options: "Customer", reqd: 1,
			  change: () => { this.customer = this.form_fields.customer.get_value(); this.load_invoices(); } },
			{ fieldtype: "Select", fieldname: "contact_method", label: "Contact Method", reqd: 1,
			  options: "Call\nEmail\nPhysical Visit\nSMS\nWhatsApp" },
			{ fieldtype: "Link", fieldname: "contact_person", label: "Contact Person", options: "Contact" },
			{ fieldtype: "Link", fieldname: "weekly_collection_plan", label: "Weekly Collection Plan", options: "Weekly Collection Plan" },
			{ fieldtype: "Date", fieldname: "next_follow_up_date", label: "Next Follow-Up Date" },
			{ fieldtype: "Small Text", fieldname: "cc_contacts", label: "CC Contacts (Emails, comma separated)" },
			{ fieldtype: "Attach", fieldname: "supporting_document", label: "Supporting Document" },
			{ fieldtype: "Small Text", fieldname: "remarks", label: "Remarks", reqd: 1 },
		];

		this.form_fields = {};
		const $form = $("#fu-form");
		$form.empty();

		fields.forEach(f => {
			const wrapper = $(`<div style="margin-bottom:14px;"></div>`).appendTo($form);
			const field = frappe.ui.form.make_control({
				parent: wrapper[0],
				df: f,
				render_input: true,
			});
			field.refresh();
			this.form_fields[f.fieldname] = field;
		});

		if (this.customer) {
			this.form_fields.customer.set_value(this.customer);
		}
		if (this.pre_weekly_plan) {
			this.form_fields.weekly_collection_plan.set_value(this.pre_weekly_plan);
		}
	}

	set_customer(customer) {
		this.customer = customer;
		this.form_fields.customer.set_value(customer);
		this.load_invoices();
	}

	load_invoices() {
		if (!this.customer) return;
		frappe.call({
			method: "debt_collection.debt_collection.api.debt_api.get_customer_invoices",
			args: { customer: this.customer },
			callback: (r) => {
				if (!r.message) return;
				this.all_invoices = r.message.invoices;
				this.render_invoice_table(this.all_invoices);
			},
		});
	}

	render_invoice_table(invoices) {
		const fmt = (v) => format_currency(v, "KES");
		$("#fu-inv-count").text(`${invoices.length} pending invoices`);

		const rows = invoices.map((inv, i) => {
			const pre_checked = this.pre_selected_invoices.some(p => p.sales_invoice === inv.name);
			return `
				<tr>
					<td><input type="checkbox" class="fu-inv-check" data-idx="${i}" ${pre_checked ? "checked" : ""}></td>
					<td>${i + 1}</td>
					<td>${inv.name}</td>
					<td>${inv.invoice_date || "-"}</td>
					<td>${inv.due_date || "-"}</td>
					<td style="color:${inv.overdue_days > 90 ? "#e53e3e" : "#dd6b20"};font-weight:700;">${inv.overdue_days}</td>
					<td>${inv.payment_terms || "CASH"}</td>
					<td>${fmt(inv.invoice_amount)}</td>
					<td>${fmt(inv.pdc_amount)}</td>
					<td style="font-weight:600;">${fmt(inv.net_outstanding)}</td>
				</tr>
			`;
		}).join("");

		$("#fu-inv-table").html(`
			<table class="dc-table dc-table-sm">
				<thead>
					<tr>
						<th><input type="checkbox" id="fu-select-all"></th>
						<th>#</th><th>Inv No.</th><th>Inv Date</th><th>Due Date</th>
						<th>Overdue Days</th><th>Terms</th><th>Inv Amt</th>
						<th>PDC Amt</th><th>Net Outstanding</th>
					</tr>
				</thead>
				<tbody>${rows || '<tr><td colspan="10" style="text-align:center;padding:20px;color:#a0aec0;">No outstanding invoices.</td></tr>'}</tbody>
			</table>
		`);

		$("#fu-select-all").on("change", function () {
			$(".fu-inv-check").prop("checked", this.checked);
		});
	}

	get_selected_invoices() {
		const selected = [];
		$(".fu-inv-check:checked").each((_, el) => {
			const inv = this.all_invoices[$(el).data("idx")];
			if (inv) selected.push({
				sales_invoice: inv.name,
				invoice_date: inv.invoice_date,
				due_date: inv.due_date,
				overdue_days: inv.overdue_days,
				invoice_amount: inv.invoice_amount,
				outstanding_amount: inv.outstanding_amount,
				pdc_amount: inv.pdc_amount,
				pdc_date: inv.pdc_date,
				net_outstanding: inv.net_outstanding,
				payment_terms: inv.payment_terms,
			});
		});
		return selected;
	}

	submit() {
		const values = {};
		let valid = true;
		["customer", "contact_method", "remarks"].forEach(f => {
			const v = this.form_fields[f].get_value();
			if (!v) {
				frappe.msgprint(`${this.form_fields[f].df.label} is required.`, "Validation Error");
				valid = false;
			}
			values[f] = v;
		});
		if (!valid) return;

		["contact_person", "next_follow_up_date", "cc_contacts", "supporting_document", "weekly_collection_plan"].forEach(f => {
			values[f] = this.form_fields[f].get_value();
		});

		const selected_invoices = this.get_selected_invoices();

		frappe.call({
			method: "debt_collection.debt_collection.api.debt_api.save_follow_up",
			args: {
				customer: values.customer,
				contact_method: values.contact_method,
				contact_person: values.contact_person || null,
				cc_contacts: values.cc_contacts || null,
				next_follow_up_date: values.next_follow_up_date || null,
				remarks: values.remarks,
				supporting_document: values.supporting_document || null,
				weekly_collection_plan: values.weekly_collection_plan || null,
				invoices: JSON.stringify(selected_invoices),
			},
			freeze: true,
			freeze_message: "Saving follow-up and sending email...",
			callback: (r) => {
				if (!r.message) return;
				frappe.show_alert({
					message: `Follow-up <a href="/app/collection-follow-up/${r.message}">${r.message}</a> saved and email sent.`,
					indicator: "green",
				}, 6);
				frappe.set_route("follow-up-dashboard");
			},
		});
	}
}
