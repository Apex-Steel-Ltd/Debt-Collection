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
			child.customer,
			child.net_outstanding,
			child.collected_amount,
			parent.start_date
		FROM `tabWeekly Collection Plan Customer` child
		JOIN `tabWeekly Collection Plan` parent ON child.parent = parent.name
		WHERE child.docstatus < 2 {status_condition}
		ORDER BY parent.start_date DESC
	"""
	
	raw_data = frappe.db.sql(query, {"status": status, "from_date": from_date, "to_date": to_date}, as_dict=True)
	
	collectors = {}
	
	for row in raw_data:
		collector = row.collector
		customer = row.customer
		if collector not in collectors:
			collectors[collector] = {
				"collector": collector,
				"customers": {}, 
			}
			
		c_dict = collectors[collector]["customers"]
		if customer not in c_dict:
			c_dict[customer] = {
				"net_outstanding": frappe.utils.flt(row.net_outstanding),
				"collected_amount": 0.0
			}
		
		c_dict[customer]["collected_amount"] += frappe.utils.flt(row.collected_amount)

	data = []
	for collector, c_data in collectors.items():
		customers_assigned = len(c_data["customers"])
		total_planned = sum(c["net_outstanding"] for c in c_data["customers"].values())
		total_collected = sum(c["collected_amount"] for c in c_data["customers"].values())
		
		data.append({
			"collector": collector,
			"customers_assigned": customers_assigned,
			"total_planned": total_planned,
			"total_collected": total_collected
		})
		
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
