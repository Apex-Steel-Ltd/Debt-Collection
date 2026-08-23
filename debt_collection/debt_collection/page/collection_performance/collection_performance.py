import frappe

@frappe.whitelist()
def get_performance_data(from_date=None, to_date=None):
	"""
	Returns performance metrics for the Collection Performance Dashboard.
	Groups by Sales Person and calculates:
	- Assigned Customers
	- Total Outstanding (current outstanding from Sales Invoices)
	- Amount Collected (from Payment Entries within date range)
	"""
	import frappe
	from frappe.utils import flt

	# Base query to resolve sales person per customer
	resolved_sp_query = """
		SELECT
			c.name AS customer,
			COALESCE(
				(SELECT st_c.sales_person
				 FROM `tabSales Team` st_c
				 WHERE st_c.parent = c.name
				   AND st_c.parenttype = 'Customer'
				   AND st_c.sales_person IS NOT NULL
				   AND st_c.sales_person != ''
				 LIMIT 1),
				(SELECT st_i.sales_person
				 FROM `tabSales Team` st_i
				 INNER JOIN `tabSales Invoice` si_fb
					 ON si_fb.name = st_i.parent
				 WHERE si_fb.customer = c.name
				   AND st_i.parenttype = 'Sales Invoice'
				   AND st_i.sales_person IS NOT NULL
				   AND st_i.sales_person != ''
				   AND si_fb.docstatus = 1
				 LIMIT 1)
			) AS sales_person
		FROM `tabCustomer` c
	"""

	# 1. Get Outstanding Amount and Customer Count per Sales Person
	outstanding_sql = f"""
		SELECT
			resolved_sp.sales_person AS collector,
			COUNT(DISTINCT si.customer) AS customers_assigned,
			SUM(si.outstanding_amount) AS total_planned
		FROM `tabSales Invoice` si
		INNER JOIN ({resolved_sp_query}) resolved_sp 
			ON resolved_sp.customer = si.customer
			AND resolved_sp.sales_person IS NOT NULL
		WHERE si.docstatus = 1
		  AND si.outstanding_amount > 0
		  AND si.is_return = 0
		GROUP BY resolved_sp.sales_person
	"""
	outstanding_data = frappe.db.sql(outstanding_sql, as_dict=True)
	
	# 2. Get Collected Amount per Sales Person (filtered by date)
	date_condition = ""
	date_params = {}
	if from_date:
		date_condition += " AND pe.posting_date >= %(from_date)s"
		date_params["from_date"] = from_date
	if to_date:
		date_condition += " AND pe.posting_date <= %(to_date)s"
		date_params["to_date"] = to_date

	collected_sql = f"""
		SELECT
			resolved_sp.sales_person AS collector,
			SUM(pe.paid_amount) AS total_collected
		FROM `tabPayment Entry` pe
		INNER JOIN ({resolved_sp_query}) resolved_sp 
			ON resolved_sp.customer = pe.party
			AND resolved_sp.sales_person IS NOT NULL
		WHERE pe.docstatus = 1
		  AND pe.party_type = 'Customer'
		  AND pe.payment_type = 'Receive'
		  {date_condition}
		GROUP BY resolved_sp.sales_person
	"""
	collected_data = frappe.db.sql(collected_sql, date_params, as_dict=True)

	# Combine the data
	collector_map = {}
	
	for row in outstanding_data:
		collector_map[row.collector] = {
			"collector": row.collector,
			"customers_assigned": row.customers_assigned,
			"total_planned": flt(row.total_planned),
			"total_collected": 0.0
		}
		
	for row in collected_data:
		if row.collector not in collector_map:
			collector_map[row.collector] = {
				"collector": row.collector,
				"customers_assigned": 0,
				"total_planned": 0.0,
				"total_collected": 0.0
			}
		collector_map[row.collector]["total_collected"] += flt(row.total_collected)

	data = list(collector_map.values())
	data.sort(key=lambda x: x["total_collected"], reverse=True)
	
	# Enrich with percentages
	for row in data:
		if row['total_planned'] > 0:
			row['collection_percent'] = round((row['total_collected'] / row['total_planned']) * 100, 2)
		else:
			row['collection_percent'] = 0.0
			
	# Global summary
	global_planned = sum(row['total_planned'] for row in data)
	global_collected = sum(row['total_collected'] for row in data)
	global_percent = round((global_collected / global_planned) * 100, 2) if global_planned > 0 else 0
	
	return {
		"data": data,
		"summary": {
			"total_planned": global_planned,
			"total_collected": global_collected,
			"overall_percent": global_percent
		}
	}
