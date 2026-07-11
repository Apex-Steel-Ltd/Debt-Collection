import frappe

@frappe.whitelist()
def get_performance_data():
	"""
	Returns performance metrics for the Collection Performance Dashboard.
	Shows collections per collector based on Weekly Collection Plan Customer data.
	"""
	# Query total outstanding planned vs total collected
	# We'll aggregate by debt_collector.
	
	query = """
		SELECT 
			COALESCE(NULLIF(debt_collector, ''), 'Unassigned') as collector,
			COUNT(DISTINCT customer) as customers_assigned,
			SUM(net_outstanding) as total_planned,
			SUM(collected_amount) as total_collected
		FROM `tabWeekly Collection Plan Customer`
		WHERE docstatus < 2
		GROUP BY collector
		ORDER BY total_collected DESC
	"""
	
	data = frappe.db.sql(query, as_dict=True)
	
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
