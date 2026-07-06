import frappe
from frappe import _
from frappe.utils import nowdate, getdate, flt, add_days, get_first_day, get_last_day


CASH_CUSTOMER = "CASH CUSTOMER CONTROL"
INTEREST_RATE = 0.14


def _get_sales_person_for_invoice(invoice_name, customer):
	"""
	If customer == CASH CUSTOMER CONTROL → fetch from Sales Invoice sales_team child.
	Otherwise → fetch from Customer sales_team child.
	"""
	if customer == CASH_CUSTOMER:
		sp = frappe.db.get_value(
			"Sales Team",
			{"parent": invoice_name, "parenttype": "Sales Invoice"},
			"sales_person"
		)
	else:
		sp = frappe.db.get_value(
			"Sales Team",
			{"parent": customer, "parenttype": "Customer"},
			"sales_person"
		)
	return sp or ""


def _get_sales_person_for_customer(customer):
	"""
	Fetch sales person for a customer from Customer sales_team child.
	Safe to call without an invoice name.
	"""
	sp = frappe.db.get_value(
		"Sales Team",
		{"parent": customer, "parenttype": "Customer"},
		"sales_person"
	)
	return sp or ""


def _get_pdc_for_invoices(invoice_names):
	"""
	Returns dict: {invoice_name: {"pdc_amount": x, "pdc_date": y}}
	PDC = submitted Payment Entry with posting_date > today linked to invoices.
	"""
	if not invoice_names:
		return {}

	placeholders = ", ".join(["%s"] * len(invoice_names))
	rows = frappe.db.sql(f"""
		SELECT
			per.reference_name AS invoice,
			SUM(per.allocated_amount) AS pdc_amount,
			MIN(pe.posting_date) AS pdc_date
		FROM `tabPayment Entry Reference` per
		INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
		WHERE
			per.reference_doctype = 'Sales Invoice'
			AND per.reference_name IN ({placeholders})
			AND pe.docstatus = 1
			AND pe.posting_date > %s
			AND pe.payment_type IN ('Receive', 'Pay')
		GROUP BY per.reference_name
	""", tuple(invoice_names) + (nowdate(),), as_dict=True)

	return {r.invoice: {"pdc_amount": r.pdc_amount, "pdc_date": str(r.pdc_date) if r.pdc_date else ""} for r in rows}


@frappe.whitelist()
def get_outstanding_customers(ageing_filter=None, collector=None, sales_person=None, search=None, page=1, page_size=50):
	"""
	Returns aggregated outstanding customer data for the Outstanding Invoices dashboard.
	ageing_filter: 'over_120' | 'over_90' | 'over_60' | 'over_30' | 'current' | None (all)
	"""
	today = getdate(nowdate())
	conditions = ["si.docstatus = 1", "si.outstanding_amount > 0", "si.is_return = 0"]
	params = []

	ageing_map = {
		"over_120": 120, "over_90": 90, "over_60": 60, "over_30": 30
	}

	if ageing_filter == "current":
		conditions.append("DATEDIFF(%s, si.due_date) <= 0")
		params.append(today)
	elif ageing_filter in ageing_map:
		days = ageing_map[ageing_filter]
		conditions.append(f"DATEDIFF(%s, si.due_date) > {days}")
		params.append(today)

	if collector:
		conditions.append("c.custom_debt_collector = %s")
		params.append(collector)

	if sales_person:
		conditions.append("""
			EXISTS (
				SELECT 1 FROM `tabSales Team` st
				WHERE st.parent = si.customer
				  AND st.parenttype = 'Customer'
				  AND st.sales_person = %s
			)
		""")
		params.append(sales_person)

	if search:
		conditions.append("(si.customer LIKE %s OR si.customer_name LIKE %s)")
		params += [f"%{search}%", f"%{search}%"]

	where_clause = " AND ".join(conditions)
	offset = (int(page) - 1) * int(page_size)

	data = frappe.db.sql(f"""
		SELECT
			si.customer,
			si.customer_name,
			c.custom_debt_collector AS debt_collector,
			COUNT(si.name) AS invoice_count,
			SUM(si.grand_total) AS total_inv_amount,
			SUM(si.outstanding_amount) AS outstanding_amount,
			AVG(GREATEST(DATEDIFF(%s, si.due_date), 0)) AS avg_overdue_days,
			GROUP_CONCAT(si.name) AS invoice_list
		FROM `tabSales Invoice` si
		LEFT JOIN `tabCustomer` c ON c.name = si.customer
		WHERE {where_clause}
		GROUP BY si.customer
		ORDER BY SUM(si.outstanding_amount) DESC
		LIMIT %s OFFSET %s
	""", [today] + params + [int(page_size), offset], as_dict=True)

	# Get total count for pagination
	count_row = frappe.db.sql(f"""
		SELECT COUNT(DISTINCT si.customer) AS total
		FROM `tabSales Invoice` si
		LEFT JOIN `tabCustomer` c ON c.name = si.customer
		WHERE {where_clause}
	""", params, as_dict=True)
	total = count_row[0].total if count_row else 0

	# Enrich with PDC data
	all_invoices = []
	for row in data:
		if row.invoice_list:
			all_invoices.extend(row.invoice_list.split(","))

	pdc_map = _get_pdc_for_invoices(all_invoices) if all_invoices else {}

	# Bulk-fetch sales persons for all customers on this page
	# Priority: Customer sales team → fallback to any invoice sales team for that customer
	customers_on_page = [row.customer for row in data if row.customer]
	sp_map = {}
	if customers_on_page:
		ph = ", ".join(["%s"] * len(customers_on_page))
		# Customer-level sales team
		sp_rows = frappe.db.sql(f"""
			SELECT parent AS customer, sales_person
			FROM `tabSales Team`
			WHERE parenttype = 'Customer' AND parent IN ({ph})
			  AND sales_person IS NOT NULL AND sales_person != ''
		""", customers_on_page, as_dict=True)
		sp_map = {r.customer: r.sales_person for r in sp_rows}

		# Fallback: invoice-level sales team for customers still missing
		missing = [c for c in customers_on_page if not sp_map.get(c)]
		if missing:
			ph2 = ", ".join(["%s"] * len(missing))
			fallback_rows = frappe.db.sql(f"""
				SELECT si.customer, st.sales_person
				FROM `tabSales Invoice` si
				INNER JOIN `tabSales Team` st ON st.parent = si.name
					AND st.parenttype = 'Sales Invoice'
				WHERE si.customer IN ({ph2})
				  AND si.docstatus = 1
				  AND st.sales_person IS NOT NULL AND st.sales_person != ''
				GROUP BY si.customer
			""", missing, as_dict=True)
			for r in fallback_rows:
				if not sp_map.get(r.customer):
					sp_map[r.customer] = r.sales_person

	# Per-customer PDC aggregation + enrichment
	for row in data:
		pdc_total = 0
		if row.invoice_list:
			for inv in row.invoice_list.split(","):
				pdc_total += flt(pdc_map.get(inv, {}).get("pdc_amount", 0))
		row.pdc_amount = pdc_total
		row.net_outstanding = flt(row.outstanding_amount) - pdc_total
		row.interest_loss = flt(row.outstanding_amount) * INTEREST_RATE * (flt(row.avg_overdue_days) / 365)
		row.sales_person = sp_map.get(row.customer, "")
		row.pop("invoice_list", None)

	return {"data": data, "total": total}


@frappe.whitelist()
def get_customer_invoices(customer):
	"""
	Returns all outstanding invoices for a customer with PDC details and ageing buckets.
	Ageing: last 6 months by name (e.g. 'Mar 2025'), older ones grouped as 'Before {6th month}'.
	"""
	today = getdate(nowdate())

	invoices = frappe.db.sql("""
		SELECT
			si.name,
			si.posting_date AS invoice_date,
			si.due_date,
			si.payment_terms_template AS payment_terms,
			si.grand_total AS invoice_amount,
			si.outstanding_amount,
			GREATEST(DATEDIFF(%s, si.due_date), 0) AS overdue_days,
			si.customer
		FROM `tabSales Invoice` si
		WHERE si.customer = %s
		  AND si.docstatus = 1
		  AND si.outstanding_amount > 0
		  AND si.is_return = 0
		ORDER BY si.due_date ASC
	""", (today, customer), as_dict=True)

	invoice_names = [i.name for i in invoices]
	pdc_map = _get_pdc_for_invoices(invoice_names)

	# Build the 6-month window: current month and 5 prior months
	import calendar
	month_names = {1:"Jan",2:"Feb",3:"Mar",4:"Apr",5:"May",6:"Jun",
	               7:"Jul",8:"Aug",9:"Sep",10:"Oct",11:"Nov",12:"Dec"}

	def month_label(year, month):
		return f"{month_names[month]} {year}"

	# Generate last 6 months as (year, month) tuples, most-recent first
	recent_months = []
	y, m = today.year, today.month
	for _ in range(6):
		recent_months.append((y, m))
		m -= 1
		if m == 0:
			m = 12
			y -= 1
	recent_months_set = {(y2, m2) for y2, m2 in recent_months}

	# The oldest of the 6 months is the cutoff
	oldest_y, oldest_m = recent_months[-1]
	oldest_label = month_label(oldest_y, oldest_m)

	ageing = {}  # {display_label: amount}
	for inv in invoices:
		pdc = pdc_map.get(inv.name, {})
		inv.pdc_amount = flt(pdc.get("pdc_amount", 0))
		inv.pdc_date = pdc.get("pdc_date", "")
		inv.net_outstanding = flt(inv.outstanding_amount) - inv.pdc_amount
		inv.sales_person = _get_sales_person_for_invoice(inv.name, customer)

		# Bucket by invoice posting month
		if inv.invoice_date:
			inv_date = getdate(str(inv.invoice_date))
			iy, im = inv_date.year, inv_date.month
			if (iy, im) in recent_months_set:
				label = month_label(iy, im)
			else:
				label = f"Before {oldest_label}"
		else:
			label = "Unknown"
		ageing[label] = flt(ageing.get(label, 0)) + flt(inv.outstanding_amount)

	# Build ordered ageing: recent 6 months (most recent first), then "Before..."
	ordered_ageing = []
	for (y2, m2) in recent_months:
		lbl = month_label(y2, m2)
		if lbl in ageing:
			ordered_ageing.append({"label": lbl, "amount": ageing[lbl]})
	before_lbl = f"Before {oldest_label}"
	if before_lbl in ageing:
		ordered_ageing.append({"label": before_lbl, "amount": ageing[before_lbl]})
	if "Unknown" in ageing:
		ordered_ageing.append({"label": "Unknown", "amount": ageing["Unknown"]})

	return {"invoices": invoices, "ageing": ordered_ageing}


@frappe.whitelist()
def get_dashboard_summary(collector=None):
	"""Recovery Dashboard summary stats, PDC ageing, JE unreconciled, SP summary."""
	today = getdate(nowdate())

	collector_cond   = " AND c.custom_debt_collector = %s" if collector else ""
	collector_params = [collector] if collector else []
	base_inv_where   = f"si.docstatus = 1 AND si.outstanding_amount > 0 AND si.is_return = 0{collector_cond}"

	# ── Invoice ageing totals ──────────────────────────────────────────────────
	totals = frappe.db.sql(f"""
		SELECT
			SUM(si.outstanding_amount) AS total_outstanding,
			SUM(CASE WHEN DATEDIFF(%s, si.due_date) <= 30
			         THEN si.outstanding_amount ELSE 0 END) AS under_30,
			SUM(CASE WHEN DATEDIFF(%s, si.due_date) BETWEEN 31 AND 60
			         THEN si.outstanding_amount ELSE 0 END) AS over_30,
			SUM(CASE WHEN DATEDIFF(%s, si.due_date) BETWEEN 61 AND 90
			         THEN si.outstanding_amount ELSE 0 END) AS over_60,
			SUM(CASE WHEN DATEDIFF(%s, si.due_date) BETWEEN 91 AND 120
			         THEN si.outstanding_amount ELSE 0 END) AS over_90,
			SUM(CASE WHEN DATEDIFF(%s, si.due_date) > 120
			         THEN si.outstanding_amount ELSE 0 END) AS over_120
		FROM `tabSales Invoice` si
		LEFT JOIN `tabCustomer` c ON c.name = si.customer
		WHERE {base_inv_where}
	""", [today, today, today, today, today] + collector_params, as_dict=True)

	# ── Total PDC (full cheque value) ──────────────────────────────────────────
	pdc_collector_cond   = " AND c.custom_debt_collector = %s" if collector else ""
	pdc_collector_params = [collector] if collector else []

	pdc_total = frappe.db.sql(f"""
		SELECT SUM(pe.paid_amount) AS total_pdc
		FROM `tabPayment Entry` pe
		LEFT JOIN `tabCustomer` c ON c.name = pe.party
		WHERE pe.payment_type = 'Receive'
		  AND pe.party_type   = 'Customer'
		  AND pe.docstatus    = 1
		  AND pe.posting_date > %s
		  {pdc_collector_cond}
	""", [today] + pdc_collector_params, as_dict=True)

	# ── PDC ageing buckets ─────────────────────────────────────────────────────
	next7  = add_days(today, 7)
	next14 = add_days(today, 14)
	next30 = add_days(today, 30)
	next60 = add_days(today, 60)

	pdc_ageing = frappe.db.sql(f"""
		SELECT
			SUM(CASE WHEN pe.posting_date <= %s THEN pe.paid_amount ELSE 0 END) AS within_7,
			SUM(CASE WHEN pe.posting_date > %s AND pe.posting_date <= %s THEN pe.paid_amount ELSE 0 END) AS day_8_14,
			SUM(CASE WHEN pe.posting_date > %s AND pe.posting_date <= %s THEN pe.paid_amount ELSE 0 END) AS day_15_30,
			SUM(CASE WHEN pe.posting_date > %s AND pe.posting_date <= %s THEN pe.paid_amount ELSE 0 END) AS day_31_60,
			SUM(CASE WHEN pe.posting_date > %s THEN pe.paid_amount ELSE 0 END) AS over_60
		FROM `tabPayment Entry` pe
		LEFT JOIN `tabCustomer` c ON c.name = pe.party
		WHERE pe.payment_type = 'Receive'
		  AND pe.party_type = 'Customer'
		  AND pe.docstatus = 1
		  AND pe.posting_date > %s
		  {pdc_collector_cond}
	""", [next7, next7, next14, next14, next30, next30, next60, next60, today] + pdc_collector_params, as_dict=True)

	# ── Unreconciled entries (JE + PE unallocated) ────────────────────────────
	je_unreconciled = frappe.db.sql("""
		SELECT
			COUNT(DISTINCT gle.party) AS customer_count,
			ABS(SUM(gle.credit - gle.debit)) AS unreconciled_amount
		FROM `tabGL Entry` gle
		WHERE gle.docstatus = 1
		  AND gle.is_cancelled = 0
		  AND gle.voucher_type = 'Journal Entry'
		  AND gle.party_type = 'Customer'
		  AND gle.party IS NOT NULL
		  AND gle.credit > gle.debit
		  AND gle.account IN (
			SELECT acc.name FROM `tabAccount` acc
			WHERE acc.account_type = 'Receivable' AND acc.is_group = 0
		  )
		  AND NOT EXISTS (
			SELECT 1 FROM `tabJournal Entry Account` jea
			WHERE jea.parent = gle.voucher_no
			  AND jea.account = gle.account
			  AND jea.party = gle.party
			  AND IFNULL(jea.reference_type, '') NOT IN ('', 'Sales Order', 'Purchase Order')
		  )
		  AND NOT EXISTS (
			SELECT 1 FROM `tabPayment Ledger Entry` ple
			WHERE ple.voucher_no = gle.voucher_no
			  AND ple.against_voucher_type = 'Sales Invoice'
			  AND ple.docstatus = 1
		  )
	""", as_dict=True)

	pe_unallocated = frappe.db.sql("""
		SELECT
			COUNT(DISTINCT party) AS customer_count,
			SUM(unallocated_amount) AS unreconciled_amount
		FROM `tabPayment Entry`
		WHERE docstatus = 1
		  AND party_type = 'Customer'
		  AND payment_type = 'Receive'
		  AND unallocated_amount > 0
	""", as_dict=True)

	je_row = je_unreconciled[0] if je_unreconciled else {}
	pe_row = pe_unallocated[0] if pe_unallocated else {}
	total_unreconciled   = flt(je_row.get("unreconciled_amount", 0)) + flt(pe_row.get("unreconciled_amount", 0))
	total_unreconciled_c = (je_row.get("customer_count") or 0) + (pe_row.get("customer_count") or 0)

	# ── Salesperson summary (top 10) ───────────────────────────────────────────
	sp_summary = frappe.db.sql(f"""
		SELECT
			resolved_sp.sales_person,
			COUNT(DISTINCT si.customer) AS customer_count,
			SUM(si.outstanding_amount)  AS outstanding_amount
		FROM `tabSales Invoice` si
		INNER JOIN (
			SELECT c.name AS customer,
				COALESCE(
					(SELECT st_c.sales_person FROM `tabSales Team` st_c
					 WHERE st_c.parent = c.name AND st_c.parenttype = 'Customer'
					   AND st_c.sales_person IS NOT NULL AND st_c.sales_person != ''
					 LIMIT 1),
					(SELECT st_i.sales_person FROM `tabSales Team` st_i
					 INNER JOIN `tabSales Invoice` si_fb ON si_fb.name = st_i.parent
					 WHERE si_fb.customer = c.name AND st_i.parenttype = 'Sales Invoice'
					   AND st_i.sales_person IS NOT NULL AND st_i.sales_person != ''
					   AND si_fb.docstatus = 1
					 LIMIT 1)
				) AS sales_person
			FROM `tabCustomer` c
		) resolved_sp ON resolved_sp.customer = si.customer
			AND resolved_sp.sales_person IS NOT NULL
		LEFT JOIN `tabCustomer` c ON c.name = si.customer
		WHERE si.docstatus = 1 AND si.outstanding_amount > 0 AND si.is_return = 0
		  {collector_cond}
		GROUP BY resolved_sp.sales_person
		ORDER BY SUM(si.outstanding_amount) DESC
		LIMIT 10
	""", collector_params, as_dict=True)

	# ── Top 10 customers ───────────────────────────────────────────────────────
	top_customers = frappe.db.sql(f"""
		SELECT
			si.customer,
			si.customer_name,
			SUM(si.outstanding_amount) AS outstanding_amount,
			COUNT(si.name)             AS invoice_count
		FROM `tabSales Invoice` si
		LEFT JOIN `tabCustomer` c ON c.name = si.customer
		WHERE {base_inv_where}
		GROUP BY si.customer
		ORDER BY SUM(si.outstanding_amount) DESC
		LIMIT 10
	""", collector_params, as_dict=True)

	# ── Recent activity ────────────────────────────────────────────────────────
	recent_cond   = "cfu.collector = %s" if collector else "1=1"
	recent_params = [collector] if collector else []

	recent_activity = frappe.db.sql(f"""
		SELECT
			cfu.name, cfu.customer, cfu.customer_name,
			cfu.contact_method, cfu.remarks, cfu.collector,
			DATE(cfu.creation) AS created_date
		FROM `tabCollection Follow Up` cfu
		WHERE {recent_cond}
		ORDER BY cfu.creation DESC
		LIMIT 10
	""", recent_params, as_dict=True)

	# ── True AR Balance from GL Entries ──────────────────────────────────────────
	true_ar = frappe.db.sql(f"""
		SELECT SUM(gle.debit - gle.credit) AS true_outstanding
		FROM `tabGL Entry` gle
		LEFT JOIN `tabCustomer` c ON c.name = gle.party
		WHERE gle.party_type = 'Customer'
		  AND gle.is_cancelled = 0
		  AND gle.posting_date <= %s
		  AND gle.account IN (SELECT name FROM `tabAccount` WHERE account_type = 'Receivable' AND is_group = 0)
		  {collector_cond}
	""", [today] + collector_params, as_dict=True)

	summary           = totals[0] if totals else {}
	total_pdc         = flt(pdc_total[0].total_pdc) if pdc_total else 0
	
	# The True AR balance inherently includes all invoices, credit notes, and unreconciled payments/JEs.
	total_outstanding = flt(true_ar[0].true_outstanding) if true_ar else 0
	
	summary["total_outstanding"] = total_outstanding
	summary["total_pdc"]         = total_pdc
	summary["net_outstanding"]   = total_outstanding - total_pdc
	summary["pdc_ageing"]        = pdc_ageing[0] if pdc_ageing else {}
	summary["je_unreconciled"]   = total_unreconciled
	summary["je_customer_count"] = total_unreconciled_c

	return {
		"summary":         summary,
		"top_customers":   top_customers,
		"recent_activity": recent_activity,
		"sp_summary":      sp_summary,
	}


@frappe.whitelist()
def get_weekly_plans(week_start=None):
	"""Get all active weekly collection plans, optionally filtered by week start date."""
	filters = {"status": ["!=", "Closed"]}
	if week_start:
		filters["start_date"] = week_start

	plans = frappe.get_all(
		"Weekly Collection Plan",
		filters=filters,
		fields=["name", "start_date", "end_date", "status"],
		order_by="start_date desc",
		limit=20,
	)
	result = []
	for plan in plans:
		customers = frappe.get_all(
			"Weekly Collection Plan Customer",
			filters={"parent": plan.name},
			fields=["customer", "customer_name", "sales_representative", "debt_collector",
					"outstanding_amount", "pdc_amount", "net_outstanding", "avg_overdue_days",
					"planner_invoices", "status"],
		)
		plan["customers"] = customers
		result.append(plan)
	return result


@frappe.whitelist()
def add_customers_to_plan(customers, week_start):
	"""
	Add a list of customer dicts to the matching Weekly Collection Plan for the given week.
	Creates the plan if it doesn't exist for that week.
	customers: JSON string list of customer names
	week_start: ISO date string (Monday of target week)
	"""
	import json
	if isinstance(customers, str):
		customers = json.loads(customers)

	week_start_date = getdate(week_start)
	week_end_date = week_start_date + __import__("datetime").timedelta(days=6)

	# Find or create plan
	existing = frappe.db.get_value(
		"Weekly Collection Plan",
		{"start_date": week_start_date, "status": ["!=", "Closed"]},
		"name"
	)

	if existing:
		plan = frappe.get_doc("Weekly Collection Plan", existing)
	else:
		plan = frappe.new_doc("Weekly Collection Plan")
		plan.start_date = week_start_date
		plan.end_date = week_end_date
		plan.status = "Open"

	# Check which customers already in plan
	existing_customers = {row.customer for row in plan.get("customers", [])}
	added, skipped = [], []

	for customer_name in customers:
		if customer_name in existing_customers:
			skipped.append(customer_name)
			continue

		# Pull live stats
		stats = _get_customer_stats(customer_name)
		sp = stats.get("sales_person", "")
		plan.append("customers", {
			"customer":            customer_name,
			"customer_name":       stats.get("customer_name", ""),
			"sales_representative": sp,
			"debt_collector":      sp,  # sales person IS the collector
			"outstanding_amount":  stats.get("outstanding_amount", 0),
			"pdc_amount":          stats.get("pdc_amount", 0),
			"net_outstanding":     stats.get("net_outstanding", 0),
			"avg_overdue_days":    stats.get("avg_overdue_days", 0),
			"planner_invoices":    stats.get("invoice_count", 0),
			"status":              "Planned",
		})
		added.append(customer_name)

	plan.save(ignore_permissions=True)
	frappe.db.commit()

	return {"plan": plan.name, "added": added, "skipped": skipped}


def _get_customer_stats(customer):
	"""Quick stats for a single customer."""
	today = getdate(nowdate())
	row = frappe.db.sql("""
		SELECT
			si.customer_name,
			COUNT(si.name) AS invoice_count,
			SUM(si.grand_total) AS total_inv_amount,
			SUM(si.outstanding_amount) AS outstanding_amount,
			AVG(GREATEST(DATEDIFF(%s, si.due_date), 0)) AS avg_overdue_days,
			GROUP_CONCAT(si.name) AS invoice_list
		FROM `tabSales Invoice` si
		WHERE si.customer = %s AND si.docstatus = 1 AND si.outstanding_amount > 0 AND si.is_return = 0
		GROUP BY si.customer
	""", (today, customer), as_dict=True)

	if not row:
		return {}

	stats = row[0]
	invoice_names = stats.invoice_list.split(",") if stats.invoice_list else []
	pdc_map = _get_pdc_for_invoices(invoice_names)
	pdc_total = sum(flt(v.get("pdc_amount", 0)) for v in pdc_map.values())
	stats.pdc_amount = pdc_total
	stats.net_outstanding = flt(stats.outstanding_amount) - pdc_total

	# Sales person from most recent invoice
	if invoice_names:
		stats.sales_person = _get_sales_person_for_invoice(invoice_names[0], customer)

	return stats


@frappe.whitelist()
def get_follow_up_dashboard(collector=None, sales_person=None, customer=None, week_start=None, page=1, page_size=20):
	"""
	Returns follow-up records grouped by ISO week, with summary stats per week
	and per-row customer outstanding totals.
	week_start: ISO date (Monday) to filter to a single week; None = all weeks.
	sales_person: filter by sales person linked to the customer
	customer: filter by specific customer
	"""
	conditions = ["1=1"]
	params = []

	if collector:
		conditions.append("cfu.collector = %s")
		params.append(collector)
	if customer:
		conditions.append("cfu.customer = %s")
		params.append(customer)
	if sales_person:
		# Sales person can be linked to customer OR invoice (for CASH CUSTOMER)
		conditions.append("""
			EXISTS (
				SELECT 1 FROM `tabSales Team` st
				WHERE (
					(st.parent = cfu.customer AND st.parenttype = 'Customer' AND st.sales_person = %s)
					OR
					(st.parenttype = 'Sales Invoice' AND st.sales_person = %s
					 AND EXISTS (
						SELECT 1 FROM `tabCollection Follow Up Invoice` cfui
						WHERE cfui.parent = cfu.name AND cfui.sales_invoice = st.parent
					 ))
				)
			)
		""")
		params += [sales_person, sales_person]
	if week_start:
		# week_start is Monday; end is Sunday
		conditions.append("DATE(cfu.creation) >= %s AND DATE(cfu.creation) <= %s")
		import datetime
		ws = frappe.utils.getdate(week_start)
		we = ws + datetime.timedelta(days=6)
		params += [ws, we]

	where = " AND ".join(conditions)
	offset = (int(page) - 1) * int(page_size)

	rows = frappe.db.sql(f"""
		SELECT
			cfu.name,
			cfu.customer,
			cfu.customer_name,
			cfu.collector,
			u.full_name AS collector_name,
			cfu.contact_method,
			cfu.remarks,
			cfu.next_follow_up_date,
			cfu.weekly_collection_plan,
			cfu.contact_person,
			cfu.cc_contacts,
			cfu.supporting_document,
			DATE(cfu.creation) AS created_date,
			YEARWEEK(cfu.creation, 1) AS iso_week,
			DATE_SUB(DATE(cfu.creation), INTERVAL WEEKDAY(cfu.creation) DAY) AS week_monday
		FROM `tabCollection Follow Up` cfu
		LEFT JOIN `tabUser` u ON u.name = cfu.collector
		WHERE {where}
		ORDER BY cfu.creation DESC
		LIMIT %s OFFSET %s
	""", params + [int(page_size), offset], as_dict=True)

	total = frappe.db.sql(f"""
		SELECT COUNT(*) AS cnt FROM `tabCollection Follow Up` cfu WHERE {where}
	""", params, as_dict=True)[0].cnt

	# Enrich each row with current outstanding for the customer AND sales person
	customers = list({r.customer for r in rows if r.customer})
	outstanding_map = {}
	if customers:
		ph = ", ".join(["%s"] * len(customers))
		os_rows = frappe.db.sql(f"""
			SELECT customer, SUM(outstanding_amount) AS outstanding
			FROM `tabSales Invoice`
			WHERE docstatus = 1 AND outstanding_amount > 0 AND is_return = 0 AND customer IN ({ph})
			GROUP BY customer
		""", customers, as_dict=True)
		outstanding_map = {r.customer: flt(r.outstanding) for r in os_rows}

	for r in rows:
		r.current_outstanding = outstanding_map.get(r.customer, 0)
		r.week_label = str(r.week_monday) if r.week_monday else "-"
		# Get sales person for this customer
		r.sales_person = _get_sales_person_for_customer(r.customer) if r.customer else ""

	# Build week-level summary (across the returned page)
	week_summary = {}
	for r in rows:
		wk = r.week_label
		if wk not in week_summary:
			week_summary[wk] = {
				"week_label": wk,
				"follow_up_count": 0,
				"unique_customers": set(),
				"total_outstanding": 0.0,
			}
		week_summary[wk]["follow_up_count"] += 1
		week_summary[wk]["unique_customers"].add(r.customer)
		week_summary[wk]["total_outstanding"] += r.current_outstanding

	for wk in week_summary:
		week_summary[wk]["customer_count"] = len(week_summary[wk].pop("unique_customers"))

	return {
		"data": rows,
		"total": total,
		"week_summary": list(week_summary.values()),
	}


@frappe.whitelist()
def update_follow_up(name, contact_method, remarks, next_follow_up_date=None,
					 contact_person=None, cc_contacts=None, supporting_document=None,
					 weekly_collection_plan=None):
	"""Update an existing Collection Follow Up record."""
	doc = frappe.get_doc("Collection Follow Up", name)
	doc.contact_method = contact_method
	doc.remarks = remarks
	doc.next_follow_up_date = next_follow_up_date or None
	doc.contact_person = contact_person or None
	doc.cc_contacts = cc_contacts or None
	doc.supporting_document = supporting_document or None
	doc.weekly_collection_plan = weekly_collection_plan or None
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return doc.name


@frappe.whitelist()
def get_je_unreconciled(page=1, page_size=50):
	"""
	Returns unreconciled entries against Receivable accounts:
	  1. Journal Entry credits not linked to any Sales Invoice
	  2. Payment Entries with unallocated_amount > 0
	"""
	offset = (int(page) - 1) * int(page_size)

	# ── Journal Entries ────────────────────────────────────────────────────────
	je_rows = frappe.db.sql("""
		SELECT
			'Journal Entry'            AS entry_type,
			gle.voucher_no             AS entry_name,
			gle.posting_date,
			gle.party                  AS customer,
			c.customer_name,
			gle.account,
			ABS(gle.credit - gle.debit) AS unreconciled_amount,
			gle.remarks                AS remarks
		FROM `tabGL Entry` gle
		LEFT JOIN `tabCustomer` c ON c.name = gle.party
		WHERE gle.docstatus = 1
		  AND gle.is_cancelled = 0
		  AND gle.voucher_type = 'Journal Entry'
		  AND gle.party_type = 'Customer'
		  AND gle.party IS NOT NULL
		  AND gle.credit > gle.debit
		  AND gle.account IN (
			SELECT acc.name FROM `tabAccount` acc
			WHERE acc.account_type = 'Receivable' AND acc.is_group = 0
		  )
		  AND NOT EXISTS (
			SELECT 1 FROM `tabJournal Entry Account` jea
			WHERE jea.parent = gle.voucher_no
			  AND jea.account = gle.account
			  AND jea.party = gle.party
			  AND IFNULL(jea.reference_type, '') NOT IN ('', 'Sales Order', 'Purchase Order')
		  )
		  AND NOT EXISTS (
			SELECT 1 FROM `tabPayment Ledger Entry` ple
			WHERE ple.voucher_no = gle.voucher_no
			  AND ple.against_voucher_type = 'Sales Invoice'
			  AND ple.docstatus = 1
		  )
		ORDER BY ABS(gle.credit - gle.debit) DESC
	""", as_dict=True)

	# ── Payment Entries with unallocated amount ────────────────────────────────
	pe_rows = frappe.db.sql("""
		SELECT
			'Payment Entry'        AS entry_type,
			pe.name                AS entry_name,
			pe.posting_date,
			pe.party               AS customer,
			pe.party_name          AS customer_name,
			pe.paid_to             AS account,
			pe.unallocated_amount  AS unreconciled_amount,
			pe.remarks             AS remarks
		FROM `tabPayment Entry` pe
		WHERE pe.docstatus = 1
		  AND pe.party_type = 'Customer'
		  AND pe.payment_type = 'Receive'
		  AND pe.unallocated_amount > 0
		ORDER BY pe.unallocated_amount DESC
	""", as_dict=True)

	# Combine, sort by amount desc, paginate
	all_rows = sorted(
		je_rows + pe_rows,
		key=lambda r: flt(r.unreconciled_amount),
		reverse=True
	)
	total        = len(all_rows)
	total_amount = sum(flt(r.unreconciled_amount) for r in all_rows)
	paged        = all_rows[offset: offset + int(page_size)]

	# Counts by type
	je_count  = sum(1 for r in all_rows if r.entry_type == "Journal Entry")
	pe_count  = sum(1 for r in all_rows if r.entry_type == "Payment Entry")
	je_amount = sum(flt(r.unreconciled_amount) for r in all_rows if r.entry_type == "Journal Entry")
	pe_amount = sum(flt(r.unreconciled_amount) for r in all_rows if r.entry_type == "Payment Entry")

	return {
		"data":         paged,
		"total":        total,
		"total_amount": total_amount,
		"je_count":     je_count,
		"pe_count":     pe_count,
		"je_amount":    je_amount,
		"pe_amount":    pe_amount,
	}


@frappe.whitelist()
def get_active_plans():
	"""
	Returns all Weekly Collection Plans with status = Open,
	enriched with per-plan customer stats and totals.
	"""
	plans = frappe.db.sql("""
		SELECT
			wcp.name,
			wcp.start_date,
			wcp.end_date,
			wcp.status,
			wcp.creation,
			COUNT(wcpc.name)                      AS customer_count,
			SUM(wcpc.outstanding_amount)          AS total_outstanding,
			SUM(wcpc.pdc_amount)                  AS total_pdc,
			SUM(wcpc.net_outstanding)             AS total_net_outstanding,
			SUM(wcpc.avg_overdue_days * 1)        AS sum_overdue,
			SUM(CASE WHEN wcpc.status = 'Planned'   THEN 1 ELSE 0 END) AS count_planned,
			SUM(CASE WHEN wcpc.status = 'Completed' THEN 1 ELSE 0 END) AS count_completed,
			SUM(CASE WHEN wcpc.status = 'Skipped'   THEN 1 ELSE 0 END) AS count_skipped
		FROM `tabWeekly Collection Plan` wcp
		LEFT JOIN `tabWeekly Collection Plan Customer` wcpc ON wcpc.parent = wcp.name
		WHERE wcp.status = 'Open'
		GROUP BY wcp.name
		ORDER BY wcp.start_date DESC
	""", as_dict=True)

	# Fetch customer rows per plan, with live-resolved sales person as collector fallback
	plan_names = [p.name for p in plans]
	customers_map = {}
	if plan_names:
		ph = ", ".join(["%s"] * len(plan_names))
		cust_rows = frappe.db.sql(f"""
			SELECT
				wcpc.parent AS plan,
				wcpc.customer,
				wcpc.customer_name,
				wcpc.sales_representative,
				/* Live-resolve collector: use stored field, fall back to sales person */
				COALESCE(
					NULLIF(wcpc.debt_collector, ''),
					c.custom_debt_collector,
					(SELECT st.sales_person FROM `tabSales Team` st
					 WHERE st.parent = wcpc.customer AND st.parenttype = 'Customer'
					   AND st.sales_person IS NOT NULL AND st.sales_person != ''
					 LIMIT 1)
				) AS debt_collector,
				wcpc.outstanding_amount,
				wcpc.pdc_amount,
				wcpc.net_outstanding,
				wcpc.avg_overdue_days,
				wcpc.planner_invoices,
				wcpc.status
			FROM `tabWeekly Collection Plan Customer` wcpc
			LEFT JOIN `tabCustomer` c ON c.name = wcpc.customer
			WHERE wcpc.parent IN ({ph})
			ORDER BY wcpc.outstanding_amount DESC
		""", plan_names, as_dict=True)
		for cr in cust_rows:
			customers_map.setdefault(cr.plan, []).append(cr)

	for p in plans:
		p.customers = customers_map.get(p.name, [])
		p.avg_overdue_days = (
			flt(p.sum_overdue) / p.customer_count if p.customer_count else 0
		)

	return plans


@frappe.whitelist()
def get_contact_query(doctype, txt, searchfield, start, page_len, filters):
	"""Link field search for Contact filtered by customer."""
	customer = (filters or {}).get("customer", "")
	return frappe.db.sql("""
		SELECT DISTINCT c.name, c.full_name
		FROM `tabContact` c
		INNER JOIN `tabDynamic Link` dl ON dl.parent = c.name
			AND dl.link_doctype = 'Customer'
			AND dl.link_name = %s
		WHERE c.name LIKE %s OR c.full_name LIKE %s
		ORDER BY c.full_name
		LIMIT %s OFFSET %s
	""", (customer, f"%{txt}%", f"%{txt}%", page_len, start))


@frappe.whitelist()
def get_contacts_for_customer(customer):
	"""Return contacts linked to a customer, for the Contact Person field."""
	rows = frappe.db.sql("""
		SELECT DISTINCT c.name, c.full_name AS contact_name, ce.email_id
		FROM `tabContact` c
		INNER JOIN `tabDynamic Link` dl ON dl.parent = c.name
			AND dl.link_doctype = 'Customer'
			AND dl.link_name = %s
		LEFT JOIN `tabContact Email` ce ON ce.parent = c.name AND ce.is_primary = 1
		ORDER BY c.full_name
	""", customer, as_dict=True)
	return rows


@frappe.whitelist()
def get_collectors():
	"""Return all users assigned as debt collector on any customer."""
	rows = frappe.db.sql("""
		SELECT DISTINCT u.name, u.full_name
		FROM `tabUser` u
		INNER JOIN `tabCustomer` c ON c.custom_debt_collector = u.name
		WHERE u.enabled = 1
		ORDER BY u.full_name
	""", as_dict=True)
	return rows


@frappe.whitelist()
def get_sales_persons():
	"""Return all distinct sales persons linked to customers."""
	rows = frappe.db.sql("""
		SELECT DISTINCT st.sales_person
		FROM `tabSales Team` st
		WHERE st.parenttype = 'Customer'
		  AND st.sales_person IS NOT NULL
		ORDER BY st.sales_person
	""", as_dict=True)
	return [r.sales_person for r in rows]


@frappe.whitelist()
def get_salesperson_dashboard(ageing_filter=None, sales_person=None):
	"""
	Returns per-sales-person outstanding summary.
	Fixes:
	 1. One sales person per customer — customer master takes priority over invoice level.
	    Uses a correlated subquery (not UNION) to prevent double-counting.
	 2. PDC fetched per-salesperson via a direct JOIN, not GROUP_CONCAT (avoids truncation).
	"""
	today = getdate(nowdate())

	ageing_map = {"over_120": 120, "over_90": 90, "over_60": 60, "over_30": 30}
	ageing_condition = ""
	ageing_params = []

	if ageing_filter == "current":
		ageing_condition = " AND DATEDIFF(%s, si.due_date) <= 0"
		ageing_params = [today]
	elif ageing_filter in ageing_map:
		days = ageing_map[ageing_filter]
		ageing_condition = f" AND DATEDIFF(%s, si.due_date) > {days}"
		ageing_params = [today]

	sp_filter_condition = ""
	sp_filter_params = []
	if sales_person:
		sp_filter_condition = " AND resolved_sp.sales_person = %s"
		sp_filter_params = [sales_person]

	# ── Step 1: resolve ONE sales person per customer ──────────────────────────
	# Inline subquery: customer-level wins; invoice-level is fallback only.
	# COALESCE picks the first non-null value. We use a correlated subquery so
	# each customer maps to exactly one sales person → no double-counting.
	sp_rows = frappe.db.sql(f"""
		SELECT
			resolved_sp.sales_person,
			COUNT(DISTINCT si.customer)             AS customer_count,
			COUNT(si.name)                          AS invoice_count,
			SUM(si.outstanding_amount)              AS outstanding_amount,
			AVG(GREATEST(DATEDIFF(%s, si.due_date), 0)) AS avg_overdue_days,
			SUM(CASE WHEN DATEDIFF(%s, si.due_date) <= 0
			         THEN si.outstanding_amount ELSE 0 END) AS bucket_current,
			SUM(CASE WHEN DATEDIFF(%s, si.due_date) BETWEEN 1  AND 30
			         THEN si.outstanding_amount ELSE 0 END) AS bucket_30,
			SUM(CASE WHEN DATEDIFF(%s, si.due_date) BETWEEN 31 AND 60
			         THEN si.outstanding_amount ELSE 0 END) AS bucket_60,
			SUM(CASE WHEN DATEDIFF(%s, si.due_date) BETWEEN 61 AND 90
			         THEN si.outstanding_amount ELSE 0 END) AS bucket_90,
			SUM(CASE WHEN DATEDIFF(%s, si.due_date) BETWEEN 91 AND 120
			         THEN si.outstanding_amount ELSE 0 END) AS bucket_120,
			SUM(CASE WHEN DATEDIFF(%s, si.due_date) > 120
			         THEN si.outstanding_amount ELSE 0 END) AS bucket_over_120
		FROM `tabSales Invoice` si
		INNER JOIN (
			/* One row per customer: customer-master SP, or first invoice-level SP as fallback */
			SELECT
				c.name AS customer,
				COALESCE(
					/* Customer-level (first match) */
					(SELECT st_c.sales_person
					 FROM `tabSales Team` st_c
					 WHERE st_c.parent = c.name
					   AND st_c.parenttype = 'Customer'
					   AND st_c.sales_person IS NOT NULL
					   AND st_c.sales_person != ''
					 LIMIT 1),
					/* Invoice-level fallback */
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
		) resolved_sp ON resolved_sp.customer = si.customer
			AND resolved_sp.sales_person IS NOT NULL
		WHERE si.docstatus = 1
		  AND si.outstanding_amount > 0
		  AND si.is_return = 0
		  {ageing_condition}
		  {sp_filter_condition}
		GROUP BY resolved_sp.sales_person
		ORDER BY SUM(si.outstanding_amount) DESC
	""", [today, today, today, today, today, today, today] + ageing_params + sp_filter_params, as_dict=True)

	# ── Step 2: PDC per salesperson — direct aggregation, no GROUP_CONCAT ─────
	# Join Payment Entry Reference → Sales Invoice → resolved_sp
	# This avoids the GROUP_CONCAT length limit entirely.
	sp_names = [r.sales_person for r in sp_rows]
	pdc_map = {}  # {sales_person: pdc_amount}
	if sp_names:
		ph = ", ".join(["%s"] * len(sp_names))
		pdc_rows = frappe.db.sql(f"""
			SELECT
				resolved_sp.sales_person,
				SUM(per.allocated_amount) AS pdc_amount
			FROM `tabPayment Entry Reference` per
			INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
			INNER JOIN `tabSales Invoice` si ON si.name = per.reference_name
			INNER JOIN (
				SELECT
					c.name AS customer,
					COALESCE(
						(SELECT st_c.sales_person FROM `tabSales Team` st_c
						 WHERE st_c.parent = c.name AND st_c.parenttype = 'Customer'
						   AND st_c.sales_person IS NOT NULL AND st_c.sales_person != ''
						 LIMIT 1),
						(SELECT st_i.sales_person FROM `tabSales Team` st_i
						 INNER JOIN `tabSales Invoice` si_fb ON si_fb.name = st_i.parent
						 WHERE si_fb.customer = c.name AND st_i.parenttype = 'Sales Invoice'
						   AND st_i.sales_person IS NOT NULL AND st_i.sales_person != ''
						   AND si_fb.docstatus = 1
						 LIMIT 1)
					) AS sales_person
				FROM `tabCustomer` c
			) resolved_sp ON resolved_sp.customer = si.customer
			WHERE per.reference_doctype = 'Sales Invoice'
			  AND pe.docstatus = 1
			  AND pe.posting_date > %s
			  AND pe.payment_type IN ('Receive', 'Pay')
			  AND resolved_sp.sales_person IN ({ph})
			GROUP BY resolved_sp.sales_person
		""", [today] + sp_names, as_dict=True)
		pdc_map = {r.sales_person: flt(r.pdc_amount) for r in pdc_rows}

	# ── Step 3: Top 5 customers per salesperson ───────────────────────────────
	top_customers_map = {}
	if sp_names:
		ph = ", ".join(["%s"] * len(sp_names))
		cust_rows = frappe.db.sql(f"""
			SELECT
				resolved_sp.sales_person,
				si.customer,
				si.customer_name,
				SUM(si.outstanding_amount) AS outstanding_amount,
				COUNT(si.name)             AS invoice_count
			FROM `tabSales Invoice` si
			INNER JOIN (
				SELECT
					c.name AS customer,
					COALESCE(
						(SELECT st_c.sales_person FROM `tabSales Team` st_c
						 WHERE st_c.parent = c.name AND st_c.parenttype = 'Customer'
						   AND st_c.sales_person IS NOT NULL AND st_c.sales_person != ''
						 LIMIT 1),
						(SELECT st_i.sales_person FROM `tabSales Team` st_i
						 INNER JOIN `tabSales Invoice` si_fb ON si_fb.name = st_i.parent
						 WHERE si_fb.customer = c.name AND st_i.parenttype = 'Sales Invoice'
						   AND st_i.sales_person IS NOT NULL AND st_i.sales_person != ''
						   AND si_fb.docstatus = 1
						 LIMIT 1)
					) AS sales_person
				FROM `tabCustomer` c
			) resolved_sp ON resolved_sp.customer = si.customer
			WHERE si.docstatus = 1
			  AND si.outstanding_amount > 0
			  AND si.is_return = 0
			  AND resolved_sp.sales_person IN ({ph})
			  {ageing_condition}
			GROUP BY resolved_sp.sales_person, si.customer
			ORDER BY resolved_sp.sales_person, SUM(si.outstanding_amount) DESC
		""", sp_names + ageing_params, as_dict=True)

		for cr in cust_rows:
			sp = cr.sales_person
			if sp not in top_customers_map:
				top_customers_map[sp] = []
			if len(top_customers_map[sp]) < 5:
				top_customers_map[sp].append({
					"customer":           cr.customer,
					"customer_name":      cr.customer_name,
					"outstanding_amount": flt(cr.outstanding_amount),
					"invoice_count":      cr.invoice_count,
				})

	# ── Step 4: Enrich and build grand totals ──────────────────────────────────
	for r in sp_rows:
		r.pdc_amount     = pdc_map.get(r.sales_person, 0)
		r.net_outstanding = flt(r.outstanding_amount) - r.pdc_amount
		r.interest_loss  = flt(r.outstanding_amount) * INTEREST_RATE * (flt(r.avg_overdue_days) / 365)
		r.top_customers  = top_customers_map.get(r.sales_person, [])

	grand = {
		"outstanding_amount": sum(flt(r.outstanding_amount) for r in sp_rows),
		"pdc_amount":         sum(flt(r.pdc_amount)         for r in sp_rows),
		"net_outstanding":    sum(flt(r.net_outstanding)     for r in sp_rows),
		"interest_loss":      sum(flt(r.interest_loss)       for r in sp_rows),
		"customer_count":     sum(r.customer_count           for r in sp_rows),
		"invoice_count":      sum(r.invoice_count            for r in sp_rows),
	}

	return {"data": sp_rows, "grand": grand}


@frappe.whitelist()
def get_follow_up_report(search=None, collector=None, start_date=None, end_date=None, page=1, page_size=50):
	"""Returns paginated follow-up log for the Follow-Up Report screen."""
	conditions = ["1=1"]
	params = []

	if search:
		conditions.append("(cfu.customer LIKE %s OR cfu.customer_name LIKE %s)")
		params += [f"%{search}%", f"%{search}%"]
	if collector:
		conditions.append("cfu.collector = %s")
		params.append(collector)
	if start_date:
		conditions.append("DATE(cfu.creation) >= %s")
		params.append(start_date)
	if end_date:
		conditions.append("DATE(cfu.creation) <= %s")
		params.append(end_date)

	where = " AND ".join(conditions)
	offset = (int(page) - 1) * int(page_size)

	rows = frappe.db.sql(f"""
		SELECT
			cfu.name,
			cfu.customer,
			cfu.customer_name,
			cfu.collector,
			u.full_name AS collector_name,
			cfu.contact_method,
			cfu.remarks,
			cfu.next_follow_up_date,
			DATE(cfu.creation) AS created_date
		FROM `tabCollection Follow Up` cfu
		LEFT JOIN `tabUser` u ON u.name = cfu.collector
		WHERE {where}
		ORDER BY cfu.creation DESC
		LIMIT %s OFFSET %s
	""", params + [int(page_size), offset], as_dict=True)

	total = frappe.db.sql(f"""
		SELECT COUNT(*) AS cnt FROM `tabCollection Follow Up` cfu WHERE {where}
	""", params, as_dict=True)[0].cnt

	return {"data": rows, "total": total}


@frappe.whitelist()
def get_pdc_aging():
	"""PDC Aging report — maturing by week buckets."""
	today = getdate(nowdate())
	next7 = add_days(today, 7)
	next14 = add_days(today, 14)
	next21 = add_days(today, 21)
	next28 = add_days(today, 28)

	rows = frappe.db.sql("""
		SELECT
			pe.party AS customer,
			c.customer_name,
			c.custom_debt_collector AS collector,
			SUM(pe.paid_amount) AS grand_total,
			SUM(CASE WHEN pe.posting_date <= %s THEN pe.paid_amount ELSE 0 END) AS this_week,
			SUM(CASE WHEN pe.posting_date > %s AND pe.posting_date <= %s THEN pe.paid_amount ELSE 0 END) AS next_14,
			SUM(CASE WHEN pe.posting_date > %s AND pe.posting_date <= %s THEN pe.paid_amount ELSE 0 END) AS next_21,
			SUM(CASE WHEN pe.posting_date > %s AND pe.posting_date <= %s THEN pe.paid_amount ELSE 0 END) AS next_28,
			SUM(CASE WHEN pe.posting_date > %s THEN pe.paid_amount ELSE 0 END) AS over_28
		FROM `tabPayment Entry` pe
		LEFT JOIN `tabCustomer` c ON c.name = pe.party
		WHERE
			pe.docstatus = 1
			AND pe.party_type = 'Customer'
			AND pe.payment_type = 'Receive'
			AND pe.posting_date > %s
		GROUP BY pe.party
		ORDER BY SUM(pe.paid_amount) DESC
	""", (next7, next7, next14, next14, next21, next21, next28, next28, today), as_dict=True)

	return rows


@frappe.whitelist()
def get_salesperson_outstanding():
	"""Salesperson-wise aggregated net outstanding."""
	today = getdate(nowdate())

	rows = frappe.db.sql("""
		SELECT
			st.sales_person,
			SUM(si.outstanding_amount) AS total_outstanding
		FROM `tabSales Invoice` si
		INNER JOIN `tabSales Team` st ON (
			CASE
				WHEN si.customer = %s THEN (st.parent = si.name AND st.parenttype = 'Sales Invoice')
				ELSE (st.parent = si.customer AND st.parenttype = 'Customer')
			END
		)
		WHERE si.docstatus = 1 AND si.outstanding_amount > 0
		GROUP BY st.sales_person
		ORDER BY SUM(si.outstanding_amount) DESC
	""", (CASH_CUSTOMER,), as_dict=True)

	return rows


@frappe.whitelist()
def save_follow_up(customer, contact_method, contact_person=None, cc_contacts=None,
				   next_follow_up_date=None, remarks=None, supporting_document=None,
				   weekly_collection_plan=None, invoices=None):
	"""Save a Collection Follow Up record (called from custom page)."""
	import json
	if isinstance(invoices, str):
		invoices = json.loads(invoices)

	doc = frappe.new_doc("Collection Follow Up")
	doc.customer = customer
	doc.contact_method = contact_method
	doc.contact_person = contact_person
	doc.cc_contacts = cc_contacts
	doc.next_follow_up_date = next_follow_up_date
	doc.remarks = remarks
	doc.supporting_document = supporting_document
	doc.weekly_collection_plan = weekly_collection_plan
	doc.collector = frappe.db.get_value("Customer", customer, "custom_debt_collector")

	if invoices:
		for inv in invoices:
			doc.append("invoices", inv)

	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return doc.name
