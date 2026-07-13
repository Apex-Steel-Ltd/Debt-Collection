import frappe
from frappe.utils import nowdate, add_days, getdate
from frappe import sendmail

def send_daily_reminders():
	if not frappe.db.get_single_value("Debt Collection Settings", "send_emails"):
		return

	today = getdate(nowdate())
	target_3_days = add_days(today, 3)

	# Get default collectors
	cc_list = []
	settings = frappe.get_doc("Debt Collection Settings")
	if settings.default_collectors:
		for row in settings.default_collectors:
			if row.collector:
				c_email = frappe.db.get_value("User", row.collector, "email")
				if c_email and c_email not in cc_list:
					cc_list.append(c_email)

	_send_follow_up_reminders(today, cc_list)
	_send_pdc_reminders(today, target_3_days, cc_list)


def _send_follow_up_reminders(today, cc_list):
	follow_ups = frappe.get_all("Collection Follow Up", filters={"next_follow_up_date": today}, fields=["name", "customer_name", "owner", "contact_method", "remarks"])
	
	for fu in follow_ups:
		if fu.owner:
			owner_email = frappe.db.get_value("User", fu.owner, "email")
			if owner_email:
				recipients = [owner_email]
				subject = f"Reminder: Follow Up Scheduled for {fu.customer_name}"
				message = f"""
				<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:700px;margin:0 auto;color:#2d3748;">
					<h2 style="color:#2b6cb0;">Follow-Up Reminder</h2>
					<p>You have a scheduled follow-up for <strong>{fu.customer_name}</strong> today.</p>
					<div style="background:#f7fafc;padding:12px;border-left:4px solid #2b6cb0;margin:16px 0;">
						<strong>Contact Method:</strong> {fu.contact_method}<br/>
						<strong>Remarks:</strong> {fu.remarks or 'N/A'}<br/>
					</div>
					<p><a href="/app/collection-follow-up/{fu.name}" style="color:#2b6cb0;">Click here</a> to view the follow-up record.</p>
				</div>
				"""
				try:
					sendmail(
						recipients=recipients,
						cc=cc_list,
						subject=subject,
						message=message,
						reference_doctype="Collection Follow Up",
						reference_name=fu.name,
						expose_recipients="header"
					)
				except Exception:
					frappe.log_error("Failed to send Follow-Up Reminder", "Debt Collection Tasks")


def _send_pdc_reminders(today, target_3_days, cc_list):
	# Find PDC for today (Maturity) or in 3 days
	pdcs = frappe.get_all(
		"Payment Entry", 
		filters={
			"payment_type": "Receive", 
			"docstatus": 1, 
			"party_type": "Customer",
			"posting_date": ["in", [today, target_3_days]]
		}, 
		fields=["name", "party", "party_name", "paid_amount", "posting_date", "reference_no"]
	)

	for pdc in pdcs:
		customer_email = frappe.db.get_value("Customer", pdc.party, "email_id")
		if not customer_email:
			continue
			
		pdc_date = getdate(pdc.posting_date)
		
		if pdc_date == today:
			title = "Cheque Maturity Notice"
			date_text = "today"
		else:
			title = "Upcoming Cheque Maturity Notice"
			date_text = f"on {frappe.utils.formatdate(pdc.posting_date)}"

		subject = f"{title}: {pdc.party_name}"
		formatted_amount = frappe.utils.fmt_money(pdc.paid_amount, currency="KES")
		
		message = f"""
		<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:700px;margin:0 auto;color:#2d3748;">
			<h2 style="color:#2b6cb0;">{title}</h2>
			<p>Dear {pdc.party_name},</p>
			<p>This is a reminder that your cheque (Ref: {pdc.reference_no or 'N/A'}) for the amount of <strong>{formatted_amount}</strong> will mature <strong>{date_text}</strong>.</p>
			<p>Your accounts will be updated accordingly once the payment is cleared.</p>
			<p>If you have any questions, please contact our collections team.</p>
		</div>
		"""
		try:
			sendmail(
				recipients=[customer_email],
				cc=cc_list,
				subject=subject,
				message=message,
				reference_doctype="Payment Entry",
				reference_name=pdc.name,
				expose_recipients="header"
			)
		except Exception:
			frappe.log_error("Failed to send PDC Maturity Reminder", "Debt Collection Tasks")
