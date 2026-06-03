import frappe
from frappe.model.document import Document
from frappe.utils import getdate, add_days


class WeeklyCollectionPlan(Document):
	def validate(self):
		if self.start_date and self.end_date:
			if getdate(self.start_date) > getdate(self.end_date):
				frappe.throw("Start Date cannot be after End Date")

	def before_insert(self):
		# Check for duplicate: same customer in same week range
		self._validate_no_duplicate_customers()

	def _validate_no_duplicate_customers(self):
		for row in self.customers:
			existing = frappe.db.sql("""
				SELECT wcp.name
				FROM `tabWeekly Collection Plan` wcp
				INNER JOIN `tabWeekly Collection Plan Customer` wcpc
					ON wcpc.parent = wcp.name
				WHERE wcpc.customer = %s
				  AND wcp.start_date <= %s
				  AND wcp.end_date >= %s
				  AND wcp.docstatus != 2
				  AND wcp.name != %s
			""", (row.customer, self.end_date, self.start_date, self.name or ""), as_dict=True)

			if existing:
				frappe.throw(
					f"Customer <b>{row.customer}</b> is already scheduled in plan "
					f"<a href='/app/weekly-collection-plan/{existing[0].name}'>{existing[0].name}</a> "
					f"which overlaps with this week."
				)
