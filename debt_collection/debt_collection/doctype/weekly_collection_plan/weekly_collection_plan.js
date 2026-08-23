// Copyright (c) 2026, Solidad Kimeu and contributors
// For license information, please see license.txt

frappe.ui.form.on("Weekly Collection Plan", {
	refresh(frm) {
	},
});

frappe.ui.form.on("Weekly Collection Plan Customer", {
	customer: function(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		if (!row.customer) return;

		frappe.call({
			method: 'debt_collection.debt_collection.api.debt_api.get_customer_plan_stats',
			args: {
				customer: row.customer
			},
			callback: function(r) {
				if (r.message && Object.keys(r.message).length > 0) {
					let stats = r.message;
					let update_dict = {
						'sales_representative': stats.sales_person || '',
						'outstanding_amount': stats.outstanding_amount || 0,
						'pdc_amount': stats.pdc_amount || 0,
						'net_outstanding': stats.net_outstanding || 0,
						'avg_overdue_days': stats.avg_overdue_days || 0,
						'planner_invoices': stats.invoice_count || 0,
					};
					
					// Override debt_collector to match backend logic (sales person IS the collector)
					if (stats.sales_person) {
						update_dict['debt_collector'] = stats.sales_person;
					}

					frappe.model.set_value(cdt, cdn, update_dict);
				}
			}
		});
	}
});
