import frappe

@frappe.whitelist()
def get_performance_data(status=None, from_date=None, to_date=None):
	"""
	Returns performance metrics for the Collection Performance Dashboard.
	Shows collections per collector based on Weekly Collection Plan Customer data.
	"""
	# Query total outstanding planned vs total collected
	# We'll aggregate by sales_representative instead of debt_collector.
	
	status_condition = ""
	if status:
		status_condition += " AND parent.status = %(status)s"
	if from_date:
		status_condition += " AND parent.start_date >= %(from_date)s"
	if to_date:
		status_condition += " AND parent.start_date <= %(to_date)s"

	query = f"""
		SELECT 
			COALESCE(NULLIF(child.sales_representative, ''), 'Unassigned') as collector,
			COUNT(DISTINCT child.customer) as customers_assigned,
			SUM(child.net_outstanding) as total_planned,
			SUM(child.collected_amount) as total_collected
		FROM `tabWeekly Collection Plan Customer` child
		JOIN `tabWeekly Collection Plan` parent ON child.parent = parent.name
		WHERE child.docstatus < 2 {status_condition}
		GROUP BY collector
		ORDER BY total_collected DESC
	"""
	
	data = frappe.db.sql(query, {"status": status, "from_date": from_date, "to_date": to_date}, as_dict=True)
	
	# Enrich with percentages
	for row in data:
		row['total_planned'] = frappe.utils.flt(row['total_planned'])
		row['total_collected'] = frappe.utils.flt(row['total_collected'])
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
