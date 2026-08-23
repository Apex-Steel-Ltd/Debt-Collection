// Copyright (c) 2026, Solidad Kimeu and contributors
// For license information, please see license.txt

frappe.query_reports["Follow Up Report"] = {
	"filters": [
		{
			"fieldname": "from_date",
			"label": __("From Date"),
			"fieldtype": "Date",
			"default": frappe.datetime.add_months(frappe.datetime.get_today(), -1)
		},
		{
			"fieldname": "to_date",
			"label": __("To Date"),
			"fieldtype": "Date",
			"default": frappe.datetime.get_today()
		},
		{
			"fieldname": "customer",
			"label": __("Customer"),
			"fieldtype": "Link",
			"options": "Customer"
		},
		{
			"fieldname": "collector",
			"label": __("Collector"),
			"fieldtype": "Link",
			"options": "User"
		}
	]
};
