# Copyright (c) 2026, Solidad Kimeu and contributors
# For license information, please see license.txt

import frappe
from frappe import _

def execute(filters=None):
	columns = get_columns()
	data = get_data(filters)
	return columns, data

def get_columns():
	return [
		{
			"fieldname": "follow_up_id",
			"label": _("Follow Up"),
			"fieldtype": "Link",
			"options": "Collection Follow Up",
			"width": 150
		},
		{
			"fieldname": "date",
			"label": _("Date"),
			"fieldtype": "Date",
			"width": 120
		},
		{
			"fieldname": "customer",
			"label": _("Customer"),
			"fieldtype": "Link",
			"options": "Customer",
			"width": 180
		},
		{
			"fieldname": "customer_name",
			"label": _("Customer Name"),
			"fieldtype": "Data",
			"width": 200
		},
		{
			"fieldname": "sales_person",
			"label": _("Sales Person"),
			"fieldtype": "Data",
			"width": 160
		},
		{
			"fieldname": "collector_name",
			"label": _("Collector"),
			"fieldtype": "Data",
			"width": 160
		},
		{
			"fieldname": "contact_method",
			"label": _("Contact Method"),
			"fieldtype": "Data",
			"width": 130
		},
		{
			"fieldname": "total_outstanding",
			"label": _("Total Outstanding Followed"),
			"fieldtype": "Currency",
			"width": 180
		},
		{
			"fieldname": "remarks",
			"label": _("Remarks"),
			"fieldtype": "Data",
			"width": 300
		}
	]

def get_data(filters):
	conditions = []
	
	if filters.get("customer"):
		conditions.append("cfu.customer = %(customer)s")
	if filters.get("from_date"):
		conditions.append("DATE(cfu.creation) >= %(from_date)s")
	if filters.get("to_date"):
		conditions.append("DATE(cfu.creation) <= %(to_date)s")
	if filters.get("collector"):
		conditions.append("cfu.owner = %(collector)s")
		
	where_clause = " AND ".join(conditions)
	if where_clause:
		where_clause = "WHERE " + where_clause
		
	query = f"""
		SELECT 
			cfu.name as follow_up_id,
			DATE(cfu.creation) as date,
			cfu.customer,
			cfu.customer_name,
			(
				SELECT st.sales_person FROM `tabSales Team` st
				WHERE st.parent = cfu.customer AND st.parenttype = 'Customer'
				AND st.sales_person IS NOT NULL AND st.sales_person != ''
				LIMIT 1
			) as sales_person,
			(SELECT full_name FROM `tabUser` WHERE name = cfu.owner) as collector_name,
			cfu.contact_method,
			cfu.remarks,
			(
				SELECT SUM(outstanding_amount) 
				FROM `tabCollection Follow Up Invoice` cfui 
				WHERE cfui.parent = cfu.name
			) as total_outstanding
		FROM `tabCollection Follow Up` cfu
		{where_clause}
		ORDER BY cfu.creation DESC
	"""
	
	data = frappe.db.sql(query, filters, as_dict=True)
	return data
